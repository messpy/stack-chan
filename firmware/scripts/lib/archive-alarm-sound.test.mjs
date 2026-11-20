import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../../host/app/archive-alarm-sound.js',import.meta.url),'utf8');


async function setup(bytes,{failReadAt=0,block=2048,sdDelayAt=0,sdDelayMs=0}={}){
 const capacity=5*block;
 const blockMs=block*1000/48000;
 let now=0,inWritable=false,sdReadInsideWritable=0,readCount=0,fileClosed=0,audioClosed=0;
 const timers=new Set(),sounds=[];
 const wav=new Uint8Array(44+bytes),header=new DataView(wav.buffer);
 header.setUint32(0,0x52494646);header.setUint32(8,0x57415645);
 header.setUint32(36,0x64617461);header.setUint16(20,1,true);
 header.setUint16(22,1,true);header.setUint16(34,16,true);
 header.setUint32(24,24000,true);header.setUint32(40,bytes,true);
 for(let i=44;i<wav.length;i++)wav[i]=(i*7)%251;
 const expected=wav.subarray(44);
 const file={
  read(target,offset){
   if(typeof target==='number')return wav.slice(offset,offset+target).buffer;
   if(inWritable)sdReadInsideWritable++;
   readCount++;
   if(sdDelayAt===readCount){
    now+=sdDelayMs;
    sounds.at(-1)?.consumeUntil(now);
   }
   if(failReadAt===readCount)throw Error('SD failure');
   target.set(wav.subarray(offset,offset+target.length));
   return target.length;
  },
  status:()=>({size:wav.length}),
  close(){fileClosed++;}
 };
 const timer={
  set(fn,delay=0){const handle={fn,at:now+delay,repeat:false};timers.add(handle);return handle;},
  repeat(fn,delay){const handle={fn,at:now+delay,repeat:true,delay};timers.add(handle);return handle;},
  clear(handle){timers.delete(handle);}
 };
 class Audio {
  constructor(options){
   this.options=options;this.available=capacity;this.staging=[];
   this.queue=[];this.played=[];this.started=false;this.closed=false;
   sounds.push(this);
  }
  callWritable(){
   inWritable=true;
   try{this.options.onWritable(this.available);}
   finally{inWritable=false;}
  }
  start(){this.started=true;this.nextDma=now+blockMs;this.callWritable();}
  stop(){
   if(!this.started)return;
   this.started=false;
   // The normal finish must drain both the DMA queue and partial staging.
   if(!this.stoppedExplicitly&&this.moduleStatus?.()==='completed'){
    assert.ok(this.queue.flat().every(value=>value===0),'DMA still has unheard PCM');
    assert.equal(this.staging.length,0,'partial staging lost');
   }
  }
  close(){assert.equal(inWritable,false,'native close inside onWritable');this.closed=true;audioClosed++;}
  write(buffer){
   if(buffer.byteLength>this.available)throw Error('AudioOut insufficient writable space');
   this.available-=buffer.byteLength;
   for(const sample of buffer){
    this.staging.push(sample);
    if(this.staging.length===block){
     this.queue.push(this.staging);
     this.staging=[];
    }
   }
  }
  consumeUntil(tick){
   let fired=false;
   while(this.started&&this.nextDma<=tick){
    this.nextDma+=blockMs;
    if(this.queue.length){
     this.played.push(...this.queue.shift());
     this.available=Math.min(capacity,this.available+block);
    }
    fired=true;
   }
   return fired;
  }
 }
 const deps={'embedded:io/audio/out':{default:Audio},timer:{default:timer},time:{default:{get ticks(){return Math.floor(now)>>>0;}}},
  base64:{default:{}},'stackchan-sdcard':{withSDCard:fn=>fn({openFile:()=>file})},
  'archive-vault':{getSettings:()=>({alarmSound:{file:'test.wav'}}),changeSettings(){},randomHex(){return 'abc';}}};
 const ctx=vm.createContext({Uint8Array,DataView,Map,Date,trace(){}});
 const module=new vm.SourceTextModule(source,{context:ctx});
 await module.link(name=>{
  assert.ok(deps[name],'unexpected import '+name);
  const values=deps[name];
  return new vm.SyntheticModule(Object.keys(values),function(){
   for(const [key,value] of Object.entries(values))this.setExport(key,value);
  },{context:ctx});
 });
 await module.evaluate();
 async function advance(duration,{pauseRefill=false,pauseLoop=false,pauseWritable=false}={}){
  for(let step=0;step<duration;step+=10){
   now+=10;
   const sound=sounds.at(-1);
   if(sound?.consumeUntil(now))sound.writablePending=true;
   if(pauseLoop)continue;
   if(sound?.writablePending&&!pauseWritable){sound.writablePending=false;sound.callWritable();}
   for(const job of [...timers]){
    if(!timers.has(job)||job.at>now)continue;
    if(job.repeat){job.at=now+job.delay;if(pauseRefill)continue;}
    else timers.delete(job);
    job.fn();
   }
  }
  await Promise.resolve();
 }
 return {
  wav,expected,advance,sounds,
  status:()=>module.namespace.alarmSoundStatus().playback,
  play:()=>module.namespace.playAlarmSound({audio:{volume:0.25}}),
  stop:()=>{sounds.at(-1).stoppedExplicitly=true;module.namespace.stopAlarmSound();},
  metrics:()=>({sdReadInsideWritable,readCount,fileClosed,audioClosed,timers:timers.size})
 };
}

test('alarm WAV: prefetch all SD I/O outside native writable callback and drain every sample',async()=>{
 const h=await setup(100000);
 const done=h.play();
 await h.advance(8000);
 assert.equal(await done,true);
 const sound=h.sounds[0],status=h.status();
 assert.equal(status.state,'completed');
 assert.equal(status.drain,'completed');
 assert.equal(status.bytes,h.expected.length);
 assert.deepEqual(sound.played.slice(0,h.expected.length),[...h.expected]);
 assert.ok(status.paddingBytes>0,'end-of-file DMA padding');
 assert.equal(h.metrics().sdReadInsideWritable,0);
 assert.equal(status.queueStarvations,0,'normal SD feed keeps the buffer filled');
 assert.ok(h.metrics().readCount>=5);
 assert.equal(h.metrics().fileClosed,1);
 assert.equal(h.metrics().audioClosed,1);
 assert.equal(h.metrics().timers,0);
});

test('alarm WAV: sub-DMA-block short file is flushed and not marked complete early',async()=>{
 const h=await setup(1000);
 const done=h.play();
 await h.advance(40);
 assert.notEqual(h.status().state,'completed','short sample must still be draining');
 await h.advance(3000);
 assert.equal(await done,true);
 assert.deepEqual(h.sounds[0].played.slice(0,1000),[...h.expected]);
 assert.equal(h.sounds[0].played.length % 2048,0);
 assert.equal(h.metrics().sdReadInsideWritable,0);
});

test('alarm WAV: a partial DMA block is preserved for medium-length files',async()=>{
 const h=await setup(26000);
 const done=h.play();await h.advance(4500);
 assert.equal(await done,true);
 assert.deepEqual(h.sounds[0].played.slice(0,26000),[...h.expected]);
 assert.equal(h.status().state,'completed');
});

test('alarm WAV: explicit stop closes asynchronously and cancels refill/drain',async()=>{
 const h=await setup(100000);
 const done=h.play();await h.advance(200);
 h.stop();await h.advance(50);
 assert.equal(await done,true);
 assert.equal(h.status().state,'stopped');
 assert.equal(h.metrics().audioClosed,1);
 assert.equal(h.metrics().fileClosed,1);
 assert.equal(h.metrics().timers,0);
});

test('alarm WAV: SD error rejects and releases audio and file handles',async()=>{
 const h=await setup(100000,{failReadAt:6});
 const promise=h.play(),rejected=assert.rejects(promise,/SD failure/);
 await h.advance(300);
 await rejected;
 assert.equal(h.status().state,'error');
 assert.equal(h.metrics().audioClosed,1);
 assert.equal(h.metrics().fileClosed,1);
 assert.equal(h.metrics().timers,0);
});

test('alarm WAV: exhausted prefetch reports feed-empty events without silent success',async()=>{
 const h=await setup(100000);
 const done=h.play();
 await h.advance(1000,{pauseRefill:true});
 assert.ok(h.status().queueStarvations>=1,'expected buffer exhaustion while SD prefetch is paused');
 await h.advance(8000);
 assert.equal(await done,true);
 assert.deepEqual(h.sounds[0].played.slice(0,100000),[...h.expected]);
});

for(const block of [2048,4092]){
 for(const bytes of [2,block,block+2,block*5,block*5+2]){
  test(`staging and drain preserve ${bytes} bytes with ${block}-byte blocks`,async()=>{
   const h=await setup(bytes,{block});
   const done=h.play();
   await h.advance(3000);
   assert.equal(await done,true);
   assert.equal(h.status().dmaWritableCapacity,block*5);
   assert.deepEqual(h.sounds[0].played.slice(0,bytes),[...h.expected]);
   assert.ok(h.sounds[0].played.slice(bytes).every(value=>value===0));
   assert.equal(h.metrics().timers,0);
  });
 }
}

test('late XS loop is visible even while the software ring still holds PCM',async()=>{
 const h=await setup(70000);
 const done=h.play();
 await h.advance(380,{pauseLoop:true});
 await h.advance(50);
 assert.ok(h.status().callbackGapMaxMs>=380);
 assert.ok(h.status().refillGapMaxMs>=380);
 assert.ok(h.status().dmaLowWatermarks>0);
 assert.ok(h.status().queueStarvations>0,'writes exhausted the remaining PCM before satisfying demand');
 await h.advance(4000);
 assert.equal(await done,true);
 assert.deepEqual(h.sounds[0].played.slice(0,70000),[...h.expected]);
});

test('slow SD is timed, and playback recovers after the blocked event loop',async()=>{
 const h=await setup(70000,{sdDelayAt:6,sdDelayMs:310});
 const done=h.play();
 await h.advance(4000);
 assert.equal(await done,true);
 assert.equal(h.status().readMaxMs,310);
 assert.ok(h.status().callbackGapMaxMs>=310);
 assert.deepEqual(h.sounds[0].played.slice(0,70000),[...h.expected]);
});

test('overlap is rejected until shutdown has finished; repeated playback releases handles',async()=>{
 const h=await setup(4098);
 for(let i=0;i<12;i++){
  const done=h.play();
  h.stop();
  await assert.rejects(h.play(),/already playing/);
  await h.advance(60);
  assert.equal(await done,true);
  assert.equal(h.metrics().timers,0);
 }
 const done=h.play();
 await h.advance(1000);
 assert.equal(await done,true);
 assert.equal(h.metrics().audioClosed,13);
 assert.equal(h.metrics().fileClosed,13);
 assert.deepEqual(h.sounds.at(-1).played.slice(0,4098),[...h.expected]);
});

test('drain requires a new DMA notification and times out with cleanup',async()=>{
 const h=await setup(1000);
 const rejected=assert.rejects(h.play(),/drain timed out/);
 await h.advance(5200,{pauseWritable:true});
 await rejected;
 assert.equal(h.status().errorStage,'drain');
 assert.equal(h.metrics().timers,0);
 assert.equal(h.metrics().audioClosed,1);
 assert.equal(h.metrics().fileClosed,1);
});
