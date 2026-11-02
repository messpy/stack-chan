import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let output,closed=0,failRead=false,tasks=[],written=[],inWritable=false;
const wav=new Uint8Array(44+20000),header=new DataView(wav.buffer);
header.setUint32(0,0x52494646);header.setUint32(8,0x57415645);header.setUint32(36,0x64617461);header.setUint16(20,1,true);header.setUint16(22,1,true);header.setUint16(34,16,true);header.setUint32(24,24000,true);header.setUint32(40,20000,true);
for(let i=44;i<wav.length;i++)wav[i]=i%251;
const file={read(target,offset){if(typeof target==='number')return wav.slice(offset,offset+target).buffer;if(failRead)throw Error('SD failure');target.set(wav.subarray(offset,offset+target.length));return target.length;},status:()=>({size:wav.length}),close(){closed++;}};
class Audio{constructor(options){this.options=options;output=this;}start(){}stop(){}close(){assert.equal(inWritable,false,'close must leave native callback');this.closed=true;}write(bytes){written.push(...bytes);}tick(){inWritable=true;this.options.onWritable(4092);inWritable=false;}}
const timer={set(fn,ms){const item={fn,ms};tasks.push(item);return item;},clear(item){tasks=tasks.filter(t=>t!==item);}};
const deps={'embedded:io/audio/out':{default:Audio},timer:{default:timer},base64:{default:{}},'stackchan-sdcard':{withSDCard:fn=>fn({openFile:()=>file})},'archive-vault':{getSettings:()=>({alarmSound:{file:'test.wav'}}),changeSettings(){},randomHex(){return 'abc';}}};
const ctx=vm.createContext({Uint8Array,DataView,Map,Date,trace(){}});
const module=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/app/archive-alarm-sound.js',import.meta.url),'utf8'),{context:ctx});
await module.link(name=>{const values=deps[name];assert.ok(values,name);return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context:ctx});});await module.evaluate();
const drain=()=>{while(tasks.length){const task=tasks.shift();task.fn();}};
let promise=module.namespace.playAlarmSound({audio:{volume:.02}});assert.equal(output.volume,.02);
for(let i=0;i<5;i++)output.tick();assert.equal(output.closed,undefined);drain();assert.equal(await promise,true);assert.deepEqual(written,[...wav.subarray(44)]);assert.equal(closed,1);
written=[];promise=module.namespace.playAlarmSound({audio:{volume:.02}});output.tick();module.namespace.stopAlarmSound();output.tick();drain();assert.equal(await promise,true);assert.equal(written.length,4092);assert.equal(closed,2);
failRead=true;promise=module.namespace.playAlarmSound({audio:{volume:.02}});const rejection=assert.rejects(promise,/SD failure/);output.tick();drain();await rejection;assert.equal(output.closed,true);assert.equal(closed,3);
console.log('Alarm PCM: ordered playback, deferred close, stop and SD failure passed');
