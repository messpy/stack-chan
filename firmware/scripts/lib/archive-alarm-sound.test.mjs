import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../../host/app/archive-alarm-sound.js',import.meta.url),'utf8');
const BLOCK=4092,CAPACITY=5*BLOCK;

async function setup(bytes,{failReadAt=0}={}){
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
   this.options=options;this.available=CAPACITY;this.staging=[];
   this.queue=[];this.played=[];this.started=false;this.closed=false;
   sounds.push(this);
  }
  callWritable(){
   inWritable=true;
   try{this.options.onWritable(this.available);}
   finally{inWritable=false;}
  }
  start(){this.started=true;this.callWritable();}
  stop(){
   if(!this.started)return;
   this.started=false;
   // The normal finish must drain both the DMA queue and partial staging.
   if(!this.stoppedExplicitly&&this.moduleStatus?.()==='completed'){
    assert.equal(this.queue.length,0,'DMA still has unheard samples');
    assert.equal(this.staging.length,0,'partial staging lost');
   }
  }
  close(){assert.equal(inWritable,false,'native close inside onWritable');this.closed=true;audioClosed++;}
  write(buffer){
   if(buffer.byteLength>this.available)throw Error('AudioOut insufficient writable space');
   this.available-=buffer.byteLength;
   for(const sample of buffer){
    this.staging.push(sample);
    if(this.staging.length===BLOCK){
     this.queue.push(this.staging);
     this.staging=[];
    }
   }
  }
  advance(){
   if(!this.started)return;
   if(this.queue.length){this.played.push(...this.queue.shift());this.available+=BLOCK;}
   this.callWritable();
  }
 }
 const deps={'embedded:io/audio/out':{default:Audio},timer:{default:timer},
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
 async function advance(duration,{pauseRefill=false}={}){
  for(let step=0;step<duration;step+=10){
   now+=10;
   if(now%90===0)sounds.at(-1)?.advance();
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
 await h.advance(200);
 assert.notEqual(h.status().state,'completed','short sample must still be draining');
 await h.advance(3000);
 assert.equal(await done,true);
 assert.deepEqual(h.sounds[0].played.slice(0,1000),[...h.expected]);
 assert.equal(h.sounds[0].played.length % BLOCK,0);
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
 const h=await setup(100000,{failReadAt:3});
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
