import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createWebPromptController} from '../../host/app/archive-web-prompt.js'
const app=new URL('../../host/app/',import.meta.url)
const text=name=>fs.readFileSync(new URL(name,app),'utf8')
const tick=()=>new Promise(resolve=>setImmediate(resolve))

function lanHarness(provider='gemini'){
 const saved=[],asked=[],shown=[];let finish;
 const chat={provider,enabled:false,recognitionMode:false,busy:false,speaker:{id:'alice'}};
 const context=vm.createContext({createWebPromptController,busy:false,monitor:{active:false},directChatStatus:()=>chat,
  getSettingsStatus:()=>({connected:true}),getSettings:()=>({api:{gemini:'DUMMY_KEY',ollama:'DUMMY_KEY'}}),
  offlineStatus:()=>({playing:false}),reminderStatus:()=>({ringing:false}),conversationInstructions:()=> 'Context for Alice',
  geminiTextChat:(...args)=>{asked.push(args);return new Promise(r=>finish=r)},
  ollamaChat:(...args)=>{asked.push(args);return new Promise(r=>finish=r)},
  archiveTranscript:(...args)=>{saved.push(args);return {id:'saved'}},
  robot:{showBalloon:answer=>shown.push(answer)},pauseDirectChat:()=>false,
  photo(){if(context.busy)throw Error('Camera busy');throw Error('Unexpected camera allocation')},
 });
 const source=text('lan-archive.js');
 vm.runInContext(source.slice(source.indexOf('  let webPromptContext;'),source.indexOf('  let usbBusy=false;'))+'\nglobalThis.rpc=execute;',context);
 return {context,chat,saved,asked,shown,finish:answer=>finish(answer),rpc:(op,args)=>context.rpc({op,args})};
}
for(const provider of ['gemini','ollama'])test(provider+' web RPC uses text-only context, fixed speaker and no tools',async()=>{
 const h=lanHarness(provider);
 assert.equal((await h.rpc('/chat/send-text',{text:'question',requestId:'integrate-01'})).status,'pending');await tick();
 assert.equal(h.asked[0][0][0].role,'system');assert.equal(h.asked[0][0][1].content,'question');
 assert.equal(h.asked[0][1].length,0);assert.equal(h.asked[0][2],undefined);
 await assert.rejects(h.rpc('/photo',{}),/busy/);
 await assert.rejects(h.rpc('/chat/start',{}),/回答/);
 h.finish('<img src=x onerror=evil()>');await tick();
 assert.equal((await h.rpc('/chat/text-result',{requestId:'integrate-01'})).status,'complete');
 assert.equal(h.saved.length,2);assert.ok(h.saved.every(args=>args[4]==='alice'));
 assert.equal(h.shown.length,1);assert.equal(h.context.busy,false);
});
test('speaker switch discards an in-flight answer rather than attributing it to another user',async()=>{
 const h=lanHarness();await h.rpc('/chat/send-text',{text:'question',requestId:'speaker-01'});await tick();
 h.chat.speaker={id:'bob'};h.finish('late');await tick();
 assert.equal((await h.rpc('/chat/text-result',{requestId:'speaker-01'})).status,'failed');
 assert.equal(h.saved.length,0);assert.equal(h.shown.length,0);assert.equal(h.context.busy,false);
});
for(const flag of ['enabled','recognitionMode'])test('voice '+flag+' blocks a web request before cloud invocation',async()=>{
 const h=lanHarness();h.chat[flag]=true;
 await assert.rejects(h.rpc('/chat/send-text',{text:'question',requestId:'voiceguard-01'}),/OFF/);
 assert.equal(h.asked.length,0);assert.equal(h.context.busy,false);
});
test('authenticated /rpc and /diagnostics retain Origin and envelope gates',async()=>{
 const routes=new Map();let calls=0;
 class Server{get(path,fn){routes.set('GET '+path,fn)}post(path,fn){routes.set('POST '+path,fn)}}
 const c=vm.createContext({HttpServerService:Server,ArchiveHTTPServer:class{},Response:class{},trace(){},PAGE:'page'});
 vm.runInContext(text('archive-web.js').replace(/^import .*\n/gm,'').replace(/export /g,''),c);
 c.actionsStub={execute:async request=>{calls++;return {op:request.op}}};
 vm.runInContext("access='DUMMY_TOKEN';actions=actionsStub;startServer()",c);
 function request({token='DUMMY_TOKEN',origin='http://board',args={}}={}){
  return {header(){},json:(value,status=200)=>({value,status}),req:{header:name=>({authorization:'Bearer '+token,host:'board',origin}[name]),query:()=>undefined,json:async()=>({op:'/chat/send-text',args})}};
 }
 const rpc=routes.get('POST /rpc');
 assert.equal((await rpc(request({token:'wrong'}))).status,401);
 assert.equal((await rpc(request({origin:'http://evil.test'}))).status,403);
 assert.equal((await rpc(request({args:[]}))).status,400);
 assert.equal(calls,0);
 assert.equal((await rpc(request())).status,200);assert.equal(calls,1);
 const diag=await routes.get('GET /diagnostics')(request());assert.equal(diag.value.op,'/diagnostics/status');
});
test('browser retry after ambiguous network loss reuses ID; XSS-like answer is plain text',async()=>{
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'question',textContent:'',disabled:false});return elements.get(id)};
 Object.defineProperty(el('webPromptAnswer'),'innerHTML',{set(){throw Error('Unsafe HTML')}});
 const ids=[];let failed=false;
 const c=vm.createContext({el,messages:async()=>{throw Error('history refresh unavailable')},setTimeout:fn=>fn(),Date,Math,
  rpc:async(op,args)=>{if(op==='/chat/send-text'){ids.push(args.requestId);if(!failed){failed=true;throw Error('network lost')}return {status:'complete',answer:'<script>evil()</script>',displayed:true,historySaved:true}}},
 });
 const page=text('archive-web-page.js');const begin=page.indexOf('let webPromptSending=');
 vm.runInContext(page.slice(begin,page.indexOf("el('webPromptSend').onclick=",begin)),c);
 await vm.runInContext('sendWebPrompt()',c);await vm.runInContext('sendWebPrompt()',c);
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
 assert.equal(el('webPromptAnswer').textContent,'<script>evil()</script>');
 assert.equal(el('webPromptSend').disabled,false);
});
