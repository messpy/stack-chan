import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../../host/app/archive-alarm-sound.js',import.meta.url),'utf8');

function setup(){
 const settings={alarmSound:null,timerSound:null};
 const store=new Map();let serial=0;
 const root={
  createDirectory(){},
  openFile({path,mode}){
   if(mode==='w+')store.set(path,new Uint8Array(0));
   if(!store.has(path))throw Error('missing file: '+path);
   return {
    write(buffer,offset){
     const bytes=new Uint8Array(buffer);
     const previous=store.get(path),next=new Uint8Array(Math.max(previous.length,offset+bytes.length));
     next.set(previous);next.set(bytes,offset);store.set(path,next);
    },
    read(target,offset){
     const source=store.get(path);
     if(typeof target==='number')return source.slice(offset,offset+target).buffer;
     const bytes=source.subarray(offset,offset+target.byteLength);
     new Uint8Array(target.buffer,target.byteOffset,target.byteLength).set(bytes);
     return bytes.length;
    },
    flush(){},close(){},status(){return {size:store.get(path).length};},
   };
  },
  move(from,to){if(!store.has(from))throw Error('missing source');store.set(to,store.get(from));store.delete(from);},
  delete(path){store.delete(path);},
  status(path){if(!store.has(path))throw Error('not found');return {isFile:()=>true,size:store.get(path).length};},
 };
 const context=vm.createContext({Uint8Array,DataView,Number,Math,Date,String,Object,trace(){}});
 const deps={
  'embedded:io/audio/out':{default:class {}},
  timer:{default:{set(){},clear(){}}},
  base64:{default:{decode:value=>Uint8Array.from(Buffer.from(value,'base64')).buffer}},
  'stackchan-sdcard':{withSDCard:fn=>fn(root)},
  'archive-vault':{
   getSettings:()=>settings,
   changeSettings:callback=>callback(settings),
   randomHex:()=>('0123456789abcdef'+(++serial).toString(16)).slice(0,16),
  },
 };
 return {settings,store,context,deps};
}
async function load(h){
 const mod=new vm.SourceTextModule(source,{context:h.context});
 await mod.link(name=>{
  const values=h.deps[name];assert.ok(values,name);
  return new vm.SyntheticModule(Object.keys(values),function(){
   for(const [k,v] of Object.entries(values))this.setExport(k,v);
  },{context:h.context});
 });
 await mod.evaluate();
 return mod.namespace;
}
function wav(samples=1000){
 const bytes=new Uint8Array(44+samples*2),view=new DataView(bytes.buffer);
 for(const [offset,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])
  for(let i=0;i<4;i++)bytes[offset+i]=s.charCodeAt(i);
 view.setUint32(4,bytes.byteLength-8,true);view.setUint32(16,16,true);
 view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);
 view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 view.setUint32(40,samples*2,true);
 return bytes;
}

test('WAV without an original MP3 can be selected for timer only, and reset safely',async()=>{
 const h=setup(),api=await load(h),buffer=wav();
 const start=api.alarmSoundCommand('begin',{role:'audio',size:buffer.length});
 assert.equal(start.offset,0);
 const first=buffer.subarray(0,8192);
 const result=api.alarmSoundCommand('chunk',{offset:0,data:Buffer.from(first).toString('base64')});
 assert.equal(result.offset,first.length);
 assert.equal(api.alarmSoundCommand('chunk',{offset:0,data:Buffer.from(first).toString('base64')}).offset,first.length);
 const saved=api.alarmSoundCommand('finish',{target:'timer',label:'試験通知.mp3'});
 assert.equal(saved.size,buffer.length);
 assert.equal(h.settings.alarmSound,null);
 assert.equal(h.settings.timerSound.label,'試験通知.mp3');
 assert.equal(api.selectedReminderSound('timer').file,saved.name);
 assert.equal(api.selectedReminderSound('alarm'),null);
 assert.equal(api.alarmSoundStatus().timerSound.file,saved.name);
 api.alarmSoundCommand('reset',{target:'timer'});
 assert.equal(h.settings.timerSound,null);
 assert.equal(api.selectedReminderSound('timer'),null);
 assert.equal(api.alarmSoundCommand('cancel').cancelled,false);
});

test('invalid WAV and invalid target do not overwrite settings; cancellation removes partial file',async()=>{
 const h=setup(),api=await load(h);
 h.settings.alarmSound={file:'existing.wav',label:'old'};
 const buffer=wav(100);
 api.alarmSoundCommand('begin',{role:'audio',size:buffer.length});
 assert.throws(()=>api.alarmSoundCommand('finish',{target:'bogus'}),/Sound upload incomplete/);
 assert.equal(api.alarmSoundCommand('chunk',{offset:0,data:Buffer.from(buffer).toString('base64')}).offset,buffer.length);
 assert.throws(()=>api.alarmSoundCommand('finish',{target:'bogus'}),/Invalid sound target/);
 assert.equal(api.alarmSoundCommand('cancel').cancelled,true);
 assert.equal(api.selectedReminderSound('alarm').file,'existing.wav');
 assert.equal([...h.store.keys()].filter(x=>x.endsWith('.part')).length,0);
 api.alarmSoundCommand('begin',{role:'audio',size:buffer.length});
 const bytes=new Uint8Array(buffer.length);
 assert.equal(api.alarmSoundCommand('chunk',{offset:0,data:Buffer.from(bytes).toString('base64')}).offset,bytes.length);
 assert.throws(()=>api.alarmSoundCommand('finish',{target:'alarm'}),/Expected 24kHz mono PCM WAV/);
 assert.equal(h.settings.alarmSound.file,'existing.wav');
 assert.equal(api.alarmSoundCommand('status').upload,null);
 assert.equal([...h.store.keys()].filter(x=>x.endsWith('.part')).length,0);
 assert.throws(()=>api.alarmSoundCommand('reset',{target:'invalid'}),/Invalid sound target/);
});

test('legacy alarmSound also plays on timer until explicitly reset',async()=>{
 const h=setup(),api=await load(h);
 h.settings.alarmSound={file:'legacy.wav',label:'legacy'};
 delete h.settings.timerSound;
 assert.equal(api.selectedReminderSound('timer').file,'legacy.wav');
 api.alarmSoundCommand('reset',{target:'timer'});
 assert.equal(api.selectedReminderSound('timer'),null);
 assert.equal(api.selectedReminderSound('alarm').file,'legacy.wav');
});
