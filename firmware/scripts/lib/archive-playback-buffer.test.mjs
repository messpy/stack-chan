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
