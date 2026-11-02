import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const outputs=[];
class AudioOut {
 constructor(options){this.options=options;outputs.push(this);this.closed=0;this.stopped=0;}
 start(){}stop(){this.stopped++}close(){this.closed++}
}
class Voice{static Normal={};constructor(){}say(){}koe(){}read24(){return 0}}
const context=vm.createContext({trace(){},Uint32Array,Float64Array,Uint8Array,ArrayBuffer,Math,Error});
const synthetic=(name,value)=>new vm.SyntheticModule(['default'],function(){this.setExport('default',value)},{context,identifier:name});
const modules=new Map([['Resource',synthetic('Resource',class{})],['embedded:io/audio/out',synthetic('embedded:io/audio/out',AudioOut)],['pins/audioout',synthetic('pins/audioout',AudioOut)],['calculate-power',synthetic('calculate-power',()=>0)],['stackchanvoice',synthetic('stackchanvoice',Voice)]]);
for(const [name,path] of [['tts-playback-lifecycle','../../host/modules/audio/tts-playback-lifecycle.ts'],['tts','../../host/modules/audio/stackchan-voice/tts-stackchan-voice.ts']]){
 const source=stripTypeScriptTypes(fs.readFileSync(new URL(path,import.meta.url),'utf8'));
 modules.set(name,new vm.SourceTextModule(source,{context,identifier:name}));
}
const tts=modules.get('tts');await tts.link(name=>{if(!modules.has(name))throw Error('Unexpected dependency: '+name);return modules.get(name)});await tts.evaluate();
let completed=0,error;
const voice=new tts.namespace.TTS();voice.stream('こんにちは',.1,e=>{completed++;error=e});
assert.equal(voice.streaming,true);voice.cancel();
assert.equal(voice.streaming,false);assert.equal(completed,1);assert.ok(error);assert.equal(outputs[0].closed,1);assert.equal(outputs[0].stopped,1);
voice.cancel();outputs[0].options.onWritable(4092);assert.equal(completed,1);assert.equal(outputs[0].closed,1);
voice.stream('もう一度',.1,()=>completed++);assert.equal(voice.streaming,true);voice.cancel();assert.equal(completed,2);assert.equal(outputs[1].closed,1);
console.log('PASS: local TTS cancellation closes output once, ignores stale callbacks and permits another utterance');
