import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {test} from 'node:test'

function fixture(){
 let io, nextTimer=0;
 const timers=new Map();
 class Client{
  constructor(){io=this;this.parts=[];this.closed=0}
  request(callbacks){this.callbacks=callbacks}
  read(){return this.parts.shift()}
  write(){}
  close(){this.closed++}
  headers(code=200){this.callbacks.onHeaders.call(this,code)}
  chunk(text){
   const part=new TextEncoder().encode(text).buffer;
   this.parts.push(part);
   this.callbacks.onReadable.call(this,part.byteLength)
  }
  end(error){this.callbacks.onDone.call(this,error)}
 }
 const context=vm.createContext({
  Timer:{set(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id},clear(id){timers.delete(id)}},
  device:{network:{https:{client:{io:Client,socket:{tls:{}}}}}},Map,Date,DataView,ArrayBuffer,Uint8Array,TextDecoder,TextEncoder,Error,trace(){}
 });
 vm.runInContext('String.fromArrayBuffer=buffer=>new TextDecoder().decode(buffer)',context);
 const src=readFileSync(new URL('../../host/app/archive-vision-http.js',import.meta.url),'utf8')
  .replace(/^import .*$/gm,'').replace(/^export /gm,'');
 vm.runInContext(src,context);
 const post=(timeoutMs=1000)=>context.postVision('ollama.com','/api/chat',[['content-type','application/json']],new ArrayBuffer(4),'POST',timeoutMs);
 const flushClose=()=>{for(const [id,t] of timers){if(t.ms===0){timers.delete(id);t.fn()}}};
 const fireTimeout=()=>{for(const [id,t] of timers){if(t.ms!==0){timers.delete(id);t.fn()}}};
 return {post,client:()=>io,flushClose,fireTimeout,status:()=>context.visionHTTPStatus()};
}
test('valid JSON prefix does not resolve until onDone and trailing whitespace arrives',async()=>{
 const f=fixture(),p=f.post();let settled=false;p.then(()=>{settled=true},()=>{settled=true});
 const io=f.client();io.headers();io.chunk('{"message":{"role":"assistant"}}');
 await Promise.resolve();assert.equal(settled,false);
 io.chunk(' \n');io.end();
 assert.equal(await p,'{"message":{"role":"assistant"}} \n');
 assert.equal(f.status().phase,'complete');
 f.flushClose();assert.equal(io.closed,1);
});
test('complete-looking prefix followed by network error must reject',async()=>{
 const f=fixture(),p=f.post(),io=f.client();
 io.headers();io.chunk('{"message":{"role":"assistant"}}');
 io.end(new Error('connection lost'));
 await assert.rejects(p,/AIへの通信に失敗しました/);
 assert.equal(f.status().phase,'error');
 f.flushClose();assert.equal(io.closed,1);
});
test('fragmented JSON succeeds after completion; invalid and empty response fail',async()=>{
 const a=fixture(),p=a.post(),io=a.client();io.headers();io.chunk('{"mess');io.chunk('age":{}}');io.end();
 assert.equal(await p,'{"message":{}}');
 const b=fixture(),q=b.post(),bad=b.client();bad.headers();bad.chunk('{"message":');bad.end();
 await assert.rejects(q,/応答JSON/);
 const c=fixture(),empty=c.post(),ec=c.client();ec.headers();ec.end();
 await assert.rejects(empty,/応答が空/);
});
test('size overflow and timeout fail once; late completion cannot flip success',async()=>{
 const f=fixture(),p=f.post(),io=f.client();io.headers();io.chunk('x'.repeat(65537));
 await assert.rejects(p,/大きすぎます/);
 io.end();assert.equal(f.status().phase,'error');
 f.flushClose();assert.equal(io.closed,1);
 const t=fixture(),q=t.post();t.fireTimeout();
 await assert.rejects(q,/タイムアウト/);
 t.client().headers();t.client().chunk('{"message":{}}');t.client().end();
 assert.equal(t.status().phase,'error');t.flushClose();assert.equal(t.client().closed,1);
});
