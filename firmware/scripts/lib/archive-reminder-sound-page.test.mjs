import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const page=fs.readFileSync(new URL('../../host/app/archive-web-page.js',import.meta.url),'utf8');
const literal=page.split('\n').find(line=>line.startsWith('const ALARM_UPLOAD_PAGE = '));
assert.ok(literal,'browser script must be embedded in the already registered page');
const script=JSON.parse(literal.slice('const ALARM_UPLOAD_PAGE = '.length,-1));

test('old private manifest boots the browser page without a newly registered module',async()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../../host/app/manifest_archive.example.json',import.meta.url),'utf8'));
 assert.equal(manifest.modules['archive-alarm-upload-page'],undefined);
 assert.doesNotMatch(page,/import\s+\w+\s+from\s+['"]archive-alarm-upload-page['"]/);
 const imports=[...page.matchAll(/^import\s+\w+\s+from\s+['"]([^'"]+)['"]/gm)].map(item=>item[1]);
 for(const name of imports)assert.ok(manifest.modules[name],name+' missing from old manifest');
 const context=vm.createContext({});
 const compiled=new vm.SourceTextModule(page,{context});
 await compiled.link(name=>new vm.SyntheticModule(['default'],function(){this.setExport('default','');},{context}));
 await compiled.evaluate();
 assert.ok(compiled.namespace.default.includes('<script>'+script+'</script>'));
 assert.ok(compiled.namespace.default.includes('id="reminderSoundUpload"'));
});

test('sound upload is valid browser JS and mounted into the authenticated settings page',()=>{
 assert.doesNotThrow(()=>new vm.Script(script));
 for(const id of ['reminderSoundFile','reminderSoundTarget','reminderSoundUpload','reminderSoundPreview',
                  'reminderSoundResetAlarm','reminderSoundResetTimer','reminderSoundCurrent','reminderSoundState'])
  assert.ok(page.includes('id="'+id+'"'),'missing id='+id);
 assert.ok(page.includes('$'+'{ALARM_UPLOAD_PAGE}'));
 assert.ok(script.includes("await req('chunk'"));
 assert.ok(script.includes("await req('finish'"));
 assert.ok(!/fetch\(['"]https?:/.test(script));
});

test('MP3 converts to 24 kHz mono WAV with bounded device chunks and timer assignment',async()=>{
 const elements=new Map();
 const byId=id=>{
  if(!elements.has(id))elements.set(id,{value:'',disabled:false,textContent:'',files:[],onclick:null});
  return elements.get(id);
 };
 byId('reminderSoundTarget').value='timer';
 byId('reminderSoundFile').files=[{name:'sound.mp3',size:128,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}];
 const calls=[],chunks=[];
 const rpc=async(op,args={})=>{
  calls.push({op,args});
  if(op.endsWith('/status'))return {sound:null,timerSound:null};
  if(op.endsWith('/begin'))return {offset:0};
  if(op.endsWith('/chunk')){
   const data=Buffer.from(args.data,'base64');chunks.push(data);
   return {offset:args.offset+data.length};
  }
  if(op.endsWith('/finish'))return {name:'alarm-generated-audio.wav'};
  if(op.endsWith('/reset'))return {sound:null,timerSound:null};
  if(op.endsWith('/preview'))return {played:true};
  if(op.endsWith('/cancel'))return {cancelled:true};
  throw Error('unexpected RPC '+op);
 };
 class AudioContext {
  decodeAudioData(){return Promise.resolve({duration:0.1});}
  close(){return Promise.resolve();}
 }
 class OfflineAudioContext {
  constructor(channels,frames,rate){assert.equal(channels,1);assert.equal(frames,2400);assert.equal(rate,24000);this.frames=frames;this.destination={};}
  createBufferSource(){return {connect(){},start(){},set buffer(value){assert.equal(value.duration,0.1);}};}
  startRendering(){return Promise.resolve({getChannelData:()=>new Float32Array(this.frames)});}
 }
 const context=vm.createContext({
  document:{getElementById:byId},window:{AudioContext,OfflineAudioContext},rpc,
  Uint8Array,DataView,Number,Math,String,Error,Date,RegExp,
  btoa:s=>Buffer.from(s,'binary').toString('base64'),confirm:()=>true,
 });
 vm.runInContext(script,context);
 await byId('reminderSoundUpload').onclick();
 assert.equal(calls.find(x=>x.op.endsWith('/begin')).args.size,4844);
 assert.equal(calls.find(x=>x.op.endsWith('/finish')).args.target,'timer');
 assert.equal(byId('reminderSoundUpload').disabled,false);
 const pcm=Buffer.concat(chunks),dv=new DataView(pcm.buffer,pcm.byteOffset,pcm.length);
 assert.equal(pcm.length,4844);assert.equal(pcm.toString('ascii',0,4),'RIFF');
 assert.equal(pcm.toString('ascii',8,12),'WAVE');assert.equal(pcm.toString('ascii',36,40),'data');
 assert.equal(dv.getUint16(20,true),1);assert.equal(dv.getUint16(22,true),1);
 assert.equal(dv.getUint32(24,true),24000);assert.equal(dv.getUint16(34,true),16);
 assert.equal(dv.getUint32(40,true),4800);
 await byId('reminderSoundPreview').onclick();
 assert.equal(calls.find(x=>x.op.endsWith('/preview')).args.kind,'timer');
 await byId('reminderSoundResetTimer').onclick();
 assert.equal(calls.find(x=>x.op.endsWith('/reset')).args.target,'timer');
 assert.equal(calls.some(x=>x.op.endsWith('/cancel')),false);
});
