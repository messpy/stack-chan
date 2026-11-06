import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import test from 'node:test'

async function harness() {
  const timers=new Map(),workers=[],outputs=[],lights=[]
  let nextTimer=0,clock=1000
  const context=vm.createContext({trace(){},Date:class extends Date{static now(){return clock}},SharedArrayBuffer,ArrayBuffer,Uint8Array,Int16Array,Int32Array,Atomics})
  context.stackchanMicrophoneActivity=active=>lights.push(active)
  class Base {
    static DISCONNECTED=0;static SPEAKING=4;static WAITING=6;static FAILED=-1
    constructor(options){Object.assign(this,{state:0,input:null,output:null,inputSampleRate:24000,outputSampleRate:24000,inputBufferSize:524288,inputBufferOffset:0,inputBuffer:new SharedArrayBuffer(524288),outputBuffer:new SharedArrayBuffer(524288),outputBufferHead:0,outputBufferTail:0,barrier:new Int32Array(new SharedArrayBuffer(4)),microphone:1,volume:0.1,onStateChanged(){},onInputLevelChanged(){},onOutputLevelChanged(){}});this.createWorker(options.specifier)}
    configureAudio(message){if(message.outputSampleRate!==this.outputSampleRate){this.outputSampleRate=message.outputSampleRate;this.output?.close();this.output=null;this.ensureOutput()}}
  }
  class Input{constructor(options){this.options=options;this.channels=1}start(){}close(){this.closed=true}read(){return new ArrayBuffer(1920)}}
  class Output{constructor(options){this.options=options;this.writes=[];outputs.push(this)}write(bytes,done){this.writes.push({bytes,done})}start(){}close(){this.closed=true}}
  Output.Async=Output
  class Worker{constructor(){workers.push(this)}postMessage(message){this.messages??=[];this.messages.push(message)}terminate(){this.closed=true}}
  const playback=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/app/archive-playback-buffer.js',import.meta.url),'utf8'),{context});await playback.link(()=>{});await playback.evaluate()
  const deps={archivePcmRingWriter:{writePcmRing(){}},ChatAudioIO:{default:Base},'embedded:io/audio/in':{default:Input},stackchanAsyncAudioOut:{default:Output},'archive-playback-buffer':{QueuedPlayback:playback.namespace.QueuedPlayback},worker:{default:Worker},timer:{default:{repeat(fn){timers.set(++nextTimer,fn);return nextTimer},set(fn){timers.set(++nextTimer,fn);return nextTimer},clear(id){timers.delete(id)}}}}
  const module=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/app/archive-chat-audioio.js',import.meta.url),'utf8'),{context})
  await module.link(name=>new vm.SyntheticModule(Object.keys(deps[name]),function(){for(const[k,v]of Object.entries(deps[name]))this.setExport(k,v)},{context}));await module.evaluate()
  const io=new module.namespace.default({specifier:'xiaozhiV1'})
  return {io,workers,outputs,timers,lights,context,advance:ms=>clock+=ms}
}
test('PCM capture alone cannot advertise XiaoZhi transmission; stopped/stale upload clears green',async()=>{
 const h=await harness(),{io}=h;io.state=4;io.captureInput(io.input);assert.equal(h.lights.at(-1),false)
 h.workers[0].onmessage({id:'uploadState',enabled:true,sentAt:1000,droppedBytes:1920});io.captureInput(io.input);assert.equal(h.lights.at(-1),true);assert.equal(io.audioHealth.overrunBytes,1920)
 h.advance(3100);io.captureInput(io.input);assert.equal(h.lights.at(-1),false)
 io.uploadState({enabled:false});assert.equal(io.audioHealth.uploadEnabled,false);io.close();assert.equal(io.audioHealth.worker,'closed')
})
test('sample-rate transition cancels old pump and late completion cannot revive old queue',async()=>{
 const h=await harness(),{io}=h;io.state=6;io.outputBufferHead=100;io.ensureOutput();const old=io.playback,done=h.outputs[0].writes[0].done
 assert.equal(h.timers.size,1);io.configureAudio({outputSampleRate:16000});assert.equal(old.queue.active,false);assert.equal(h.outputs[0].closed,true);assert.equal(h.timers.size,1);assert.equal(io.playback.rate,16000)
 done(null);assert.equal(old.queue.free.length,0);io.close();assert.equal(h.timers.size,0);assert.equal(h.lights.at(-1),false)
})
test('late Worker and input callbacks after close cannot access released audio',async()=>{
 const h=await harness(),{io}=h,input=io.input,callback=h.workers[0].onmessage;io.close();io.close();assert.doesNotThrow(()=>callback({id:'listen'}));assert.doesNotThrow(()=>io.captureInput(input));assert.equal(input.closed,true);assert.equal(h.outputs.length,0)
})
test('allocation failure after output construction closes I2S and clears timer',async()=>{
 const h=await harness(),{io}=h;io.outputBuffer=null;assert.throws(()=>io.ensureOutput());assert.equal(h.outputs[0].closed,true);assert.equal(io.output,null);assert.equal(h.timers.size,0)
})
