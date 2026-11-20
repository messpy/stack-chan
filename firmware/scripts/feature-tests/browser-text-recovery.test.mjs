import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../../../',import.meta.url);
const source=fs.readFileSync(new URL('firmware/host/app/archive-features-page.js',root),'utf8');
test('an ambiguous browser text submission recovers its existing ID without resending the message',async()=>{
 const module=new vm.SourceTextModule(source);await module.link(()=>{throw Error('unexpected import');});await module.evaluate();
 const nodes=new Map(),calls=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,textContent:'',append(){},replaceChildren(){}});return nodes.get(id);};
 const context=vm.createContext({document:{getElementById:node},setTimeout,clearTimeout,Date,Math,confirm:()=>false,rpc:async(op,args)=>{
  calls.push({op,args});
  if(op==='/chat/text'){const error=new Error('lost response');error.networkFailure=true;throw error;}
  if(op==='/chat/text/status')return {state:'completed',answer:'取得済みの回答'};
  if(op==='/ai-schedule/status')return {enabled:false,on:480,off:1380};
  if(op==='/camera-watch/status')return {enabled:false,interval:60,sensitivity:'medium',roi:'all',events:[]};
  throw Error('unexpected operation '+op);
 }});
 vm.runInContext(module.namespace.default,context);node('aiText').value='一度だけ送信';await node('aiTextSend').onclick();
 const writes=calls.filter(x=>x.op==='/chat/text'),reads=calls.filter(x=>x.op==='/chat/text/status');
 assert.equal(writes.length,1);assert.equal(reads.length,1);assert.equal(reads[0].args.id,writes[0].args.id);
 assert.equal(node('aiTextAnswer').textContent,'取得済みの回答');assert.equal(node('aiTextSend').disabled,false);
});
