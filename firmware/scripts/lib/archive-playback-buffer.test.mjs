import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PlaybackBuffer}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-playback-buffer.js',import.meta.url))).toString('base64'));
const planner=new PlaybackBuffer(64,1000),ring=Uint8Array.from({length:64},(_,i)=>i),played=[];let tail=0;
function play(head,size,finished=false){const p=planner.plan(head,tail,size,finished);for(const part of p.segments)played.push(...ring.subarray(part.offset,part.offset+part.size));tail=p.next;return p;}
assert.equal(play(12,16).count,0);assert.equal(tail,0);
assert.equal(play(40,16).count,16);assert.equal(play(40,16).count,16);
assert.equal(play(40,16).count,0);assert.equal(planner.underruns,1);assert.equal(tail,32);
assert.equal(play(40,16).count,0);assert.equal(planner.underruns,1);
ring.set([64,65,66,67],0);
assert.equal(play(4,16).count,16);assert.equal(play(4,16).count,16);
assert.equal(play(4,16).count,0);assert.equal(play(4,16,true).count,4);
assert.deepEqual(played,Array.from({length:68},(_,i)=>i));assert.equal(play(4,16,true).complete,true);
const short=new PlaybackBuffer(1024,24000);assert.equal(short.plan(24,0,128,true).count,24);
assert.equal(short.plan(24,0,128,false).count,0);
console.log('PASS: jitter prebuffer/rebuffer, ordered PCM across wrap, no duplicate/lost bytes, short final reply drains');

for(let seed=1;seed<=30;seed++){
 let randomState=seed,head=0,tail=0,produced=0,consumed=0;
 const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296};
 const model=new PlaybackBuffer(256,1000),memory=new Uint8Array(256),expected=[];
 for(let step=0;step<20000&&(produced<2000||expected.length);step++){
   if(produced<2000&&random()<0.7){
     const amount=Math.min(2000-produced,Math.floor((254-expected.length)/2)*2,2+Math.floor(random()*30)*2);
     for(let i=0;i<amount;i++){if(head===256)head=0;const value=produced++%256;memory[head++]=value;expected.push(value)}
   }
   const before=expected.length,p=model.plan(head,tail,2+Math.floor(random()*25)*2,produced===2000);
   assert.equal(p.available,before);
   const received=p.segments.flatMap(part=>Array.from(memory.subarray(part.offset,part.offset+part.size)));
   assert.deepEqual(received,expected.splice(0,p.count));consumed+=p.count;tail=p.next;
 }
 assert.equal(consumed,2000);assert.equal(expected.length,0);
}
console.log('PASS: 30 deterministic jitter streams preserve all PCM bytes through repeated ring wraps');

const adaptive=new PlaybackBuffer(512000,24000,2000);
let state=adaptive.plan(96000,0,4800);assert.equal(state.count,4800);
state=adaptive.plan(96000,95000,4800);assert.equal(state.count,0);assert.equal(adaptive.underruns,1);
// After starvation, a 2-second burst is held until a larger cushion exists.
assert.equal(adaptive.plan(191000,95000,4800).count,0);
assert.equal(adaptive.plan(287000,95000,4800).count,4800);
// A short completed answer must never wait for the large streaming threshold.
const final=adaptive.plan(96000,95000,4800,true);assert.equal(final.count,1000);assert.equal(final.complete,true);
console.log('PASS: adaptive buffering increases jitter tolerance while completed short replies drain');

const {QueuedPlayback}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-playback-buffer.js',import.meta.url))).toString('base64'));
// Native consumes queued shared copies while JavaScript callbacks are stalled.
for(const incoming of [28800,96000]){
 let clock=0,ack=0;const pending=[],callbacks=[],actual=[],memory=new SharedArrayBuffer(131072),source=new Uint8Array(memory);
 for(let i=0;i<incoming;i++)source[i]=i%251;
 const model=new QueuedPlayback({ring:memory,slots:8,prebufferMs:600,now:()=>clock,ack:n=>ack=n,write:(bytes,done)=>pending.push({bytes,done,offset:0})});model.drainMs=100;
 model.pump(incoming,false);assert.ok(model.queuedBytes<=model.chunkBytes*8);assert.equal(ack,Math.min(Math.floor(incoming/8192)*8192,65536));
 source.fill(255,0,ack); // Producer reuses acknowledged ring space immediately.
 const consume=amount=>{while(amount&&pending.length){const front=pending[0],n=Math.min(amount,front.bytes.length-front.offset);actual.push(...front.bytes.subarray(front.offset,front.offset+n));front.offset+=n;amount-=n;if(front.offset===front.bytes.length){pending.shift();callbacks.push(()=>front.done(null))}}return amount};
 clock=500;assert.equal(consume(24000),0,'native queue covers a 500ms JS/UI pause');assert.equal(callbacks.length,2);assert.equal(model.planner.underruns,0);
 while(callbacks.length)callbacks.shift()();model.pump(incoming,true);
 for(let i=0;i<30&&(pending.length||model.pending);i++){consume(4096);clock+=85;while(callbacks.length)callbacks.shift()();model.pump(incoming,true)}
 assert.deepEqual(actual,Array.from({length:incoming},(_,i)=>i%251));assert.equal(model.pump(incoming,true).complete,true);
 model.close();assert.equal(model.active,false);
}
console.log('PASS: native queue continues through a 500ms JS pause, shared PCM survives producer reuse, bounded memory and final drain');

for(let seed=1;seed<=12;seed++){
 let clock=0,head=0,tail=0,produced=0,played=0,randomState=seed;const capacity=2048,memory=new SharedArrayBuffer(capacity),bytes=new Uint8Array(memory),native=[];
 const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296};
 const model=new QueuedPlayback({ring:memory,rate:1000,prebufferMs:100,chunkBytes:128,slots:4,now:()=>clock,ack:n=>tail=n,write:(data,done)=>native.push({data,done,offset:0})});model.drainMs=50;
 for(let step=0;step<20000&&(produced<20000||played<20000);step++){
  const available=head>=tail?head-tail:capacity-tail+head,free=capacity-available-2;
  const amount=Math.min(20000-produced,free,Math.floor(random()*100)*2);
  for(let i=0;i<amount;i++){if(head===capacity)head=0;bytes[head++]=produced++%251;}
  if(random()<0.7)model.pump(head,produced===20000);
  let remaining=2+Math.floor(random()*60)*2;
  while(remaining&&native.length){const entry=native[0],n=Math.min(remaining,entry.data.length-entry.offset);for(let i=0;i<n;i++)assert.equal(entry.data[entry.offset+i],played++%251);entry.offset+=n;remaining-=n;if(entry.offset===entry.data.length){native.shift();entry.done(null)}}
  clock+=20;assert.ok(model.pending<=4);assert.ok(model.queuedBytes<=512);
 }
 assert.equal(played,20000);assert.equal(model.pump(head,true).complete,true);
}
console.log('PASS: asynchronous playback preserves PCM through jitter, queue backpressure and repeated wraps across 12 streams');

{
 const memory=new SharedArrayBuffer(1024);let acked=0,completion;
 const fail=new QueuedPlayback({ring:memory,prebufferMs:1,ack:()=>acked++,write:()=>{throw Error('native queue unavailable')}});
 assert.throws(()=>fail.pump(100,true),/unavailable/);assert.equal(acked,0);assert.equal(fail.pending,0);
 const stopped=new QueuedPlayback({ring:memory,prebufferMs:1,ack:()=>{},write:(_bytes,done)=>completion=done});stopped.pump(100,true);stopped.close();assert.doesNotThrow(()=>completion(Error('closed')));assert.equal(stopped.error,undefined);
}
console.log('PASS: native enqueue failure does not acknowledge lost PCM; callbacks after close are ignored');

// A new spoken turn continues at the ring cursor left by the previous turn.
{
 const memory=new SharedArrayBuffer(256),bytes=new Uint8Array(memory),sent=[];
 bytes.fill(255);bytes.set(Array.from({length:32},(_,i)=>i),100);
 const second=new QueuedPlayback({ring:memory,tail:100,prebufferMs:1,write:(pcm,done)=>{sent.push(...pcm);done(null)},ack:()=>{}});
 assert.equal(second.pump(132,true).complete,true);assert.deepEqual(sent,Array.from({length:32},(_,i)=>i));
}
console.log('PASS: next spoken turn starts at the previous cursor without replaying earlier audio');

{
 const ring=new SharedArrayBuffer(131072),queued=[];let clock=0;
 const model=new QueuedPlayback({ring,prebufferMs:1500,now:()=>clock,write:(bytes,done)=>queued.push({bytes,done}),ack(){}});
 model.pump(120000,false);
 let budget=67200; // 1.4 seconds at 24 kHz mono PCM, no JavaScript callbacks.
 for(const item of queued){const used=Math.min(budget,item.bytes.length);budget-=used;if(!budget)break}
 assert.equal(budget,0,'default native queue must cover the observed 1.36s JS stall');
 assert.equal(model.planner.underruns,0);model.close();
}
console.log('PASS: native queue covers a 1.4-second JS stall without relying on main-thread callbacks');

// Regression: a short but non-empty PCM tail must still reach AudioOut.Async.
{
  const ring=new SharedArrayBuffer(1024),written=[];let clock=0,tail=0
  const model=new QueuedPlayback({
    ring,rate:1000,prebufferMs:1,chunkBytes:128,slots:1,
    now:()=>clock,ack:next=>tail=next,
    write:(pcm,done)=>written.push({pcm:Uint8Array.from(pcm),done}),
  })
  model.drainMs=20
  model.pump(256,false)
  assert.equal(written.length,1)
  written.shift().done(null)
  clock=100
  model.pump(256,false)
  assert.equal(written.length,1)
  written.shift().done(null)
  clock=200
  const plan=model.pump(280,false)
  assert.equal(plan.underruns,0,'a non-empty partial PCM chunk is not starvation')
  assert.equal(written.length,1,'remaining 24 bytes are queued immediately')
  assert.equal(written[0].pcm.byteLength,24)
  assert.equal(tail,280)
  written.shift().done(null)
  clock=300
  assert.equal(model.pump(280,false).underruns,1,'a truly empty ring and native queue underruns')
  model.close()
}
console.log('PASS: sub-chunk PCM no longer causes a false underrun or extra buffering');
