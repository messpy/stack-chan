import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const settings={api:{ollama:'DUMMY_OLLAMA_KEY'},ollamaModel:'gemma4:31b'};let requests=[],replies=[];
const context=vm.createContext({ArrayBuffer:{fromString:text=>Buffer.from(text)}});
const dependencies={
 'archive-vault':{getSettings:()=>settings},
 'base64':{default:{encode:bytes=>Buffer.from(bytes).toString('base64')}},
 'archive-vision-http':{postVision:async(host,path,headers,body,method,timeout)=>{requests.push({host,path,headers,body:JSON.parse(body.toString()),method,timeout});const next=replies.shift();if(next instanceof Error)throw next;return JSON.stringify(next);}}
};
const module=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/app/archive-ollama.js',import.meta.url),'utf8'),{context});
await module.link(name=>{const values=dependencies[name];return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});});await module.evaluate();const api=module.namespace;
settings.api.ollama='';await assert.rejects(api.ollamaChat([]),/APIキー/);assert.equal(requests.length,0);settings.api.ollama='DUMMY_OLLAMA_KEY';
replies=[{message:{role:'assistant',content:'こんにちは'}}];assert.equal(await api.ollamaChat([{role:'user',content:'こんにちは'}]),'こんにちは');
assert.equal(requests[0].host,'ollama.com');assert.equal(requests[0].path,'/api/chat');assert.equal(requests[0].method,'POST');assert.equal(requests[0].body.stream,false);assert.equal(requests[0].body.model,settings.ollamaModel);assert.equal(new Map(requests[0].headers).get('authorization'),'Bearer DUMMY_OLLAMA_KEY');
replies=[{message:{role:'assistant',content:'',tool_calls:[{function:{name:'timer_create',arguments:{seconds:30}}}]}},{message:{role:'assistant',content:'30秒のタイマーを設定しました'}}];let called=0;
const answer=await api.ollamaChat([{role:'user',content:'30秒計って'}],[{name:'timer_create',inputSchema:{type:'object',properties:{seconds:{type:'integer'}}}}],async(name,args)=>{called++;assert.equal(name,'timer_create');assert.equal(args.seconds,30);return {ok:true};});assert.equal(called,1);assert.match(answer,/30秒/);assert.equal(requests.at(-1).body.messages.at(-1).role,'tool');
replies=[{message:{role:'assistant',content:'',tool_calls:[{function:{name:'unknown',arguments:{}}}]}}];await assert.rejects(api.ollamaChat([],[{name:'timer_create'}],()=>called++),/未登録/);assert.equal(called,1);
let current=true;dependencies['archive-vision-http'].postVision;const before=requests.length;await assert.rejects(api.ollamaChat([],[],undefined,()=>false),/切り替わった/);assert.equal(requests.length,before);
replies=[{message:{role:'assistant',content:'画像です'}}];const jpeg=Buffer.from([255,216,255,217]);assert.equal((await api.ollamaVision(jpeg,'何？')).provider,'ollama');assert.equal(requests.at(-1).body.messages[1].images[0],jpeg.toString('base64'));
replies=[new Error('Ollama Cloud: HTTP 401')];const check=await api.checkOllama();assert.equal(check.authenticated,false);assert.match(check.error,/401/);
replies=Array.from({length:5},()=>({message:{role:'assistant',tool_calls:[{function:{name:'timer_create',arguments:{}}}]}}));await assert.rejects(api.ollamaChat([],[{name:'timer_create'}],async()=>({ok:true})),/回数/);
console.log('PASS: cloud endpoint/auth, missing key, selected model, tool execution/result loop, allowlist, stale-session guard, image bytes, API errors, bounded tool rounds');
