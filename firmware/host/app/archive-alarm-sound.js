import AudioOut from 'pins/audioout';
import Base64 from 'base64';
import {withSDCard} from 'stackchan-sdcard';
import {getSettings,changeSettings,randomHex} from 'archive-vault';
let upload,stopPlayback,lastPlayback;
const folder='stackchan/';
export function alarmSoundStatus(){return {sound:getSettings().alarmSound||null,playback:lastPlayback||null,upload:upload?{role:upload.role,offset:upload.offset,size:upload.size}:null};}
function wavInfo(file){const b=file.read(44,0),v=new DataView(b);if(b.byteLength!==44||v.getUint32(0,false)!==0x52494646||v.getUint32(8,false)!==0x57415645||v.getUint32(36,false)!==0x64617461||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint16(34,true)!==16||v.getUint32(24,true)!==24000)throw new Error('Expected 24kHz mono PCM WAV');const bytes=v.getUint32(40,true);if(bytes<2||bytes%2||bytes+44!==file.status().size)throw new Error('Invalid WAV size');return {bytes,sampleRate:24000,duration:bytes/48000};}
export function alarmSoundCommand(op,args={}){
 if(op==='status')return alarmSoundStatus();
 if(op==='begin'){
  if(!['source','audio'].includes(args.role)||!Number.isSafeInteger(args.size)||args.size<44||args.size>32000000)throw new Error('Invalid sound upload');
  if(upload){withSDCard(()=>upload.file.close());upload=undefined;}
  const name='alarm-'+randomHex().slice(0,16)+'-'+(args.role==='source'?'source.mp3':'audio.wav');
  withSDCard(root=>{try{root.createDirectory('stackchan');}catch(_){}upload={name,role:args.role,size:args.size,offset:0,file:root.openFile({path:folder+name+'.part',mode:'w+'})};});
  return {offset:0};
 }
 if(op==='chunk'){
  if(!upload||typeof args.data!=='string'||args.data.length>11000)throw new Error('Sound upload unavailable');
  const bytes=Base64.decode(args.data),offset=Number(args.offset);if(!Number.isSafeInteger(offset)||offset<0||!bytes.byteLength||bytes.byteLength>8192||offset+bytes.byteLength>upload.size)throw new Error('Invalid sound chunk');
  withSDCard(()=>{if(offset===upload.offset){upload.file.write(bytes,offset);upload.offset+=bytes.byteLength;}else if(offset+bytes.byteLength<=upload.offset){const previous=new Uint8Array(upload.file.read(bytes.byteLength,offset)),next=new Uint8Array(bytes);for(let i=0;i<next.length;i++)if(previous[i]!==next[i])throw new Error('Sound retry mismatch');}else throw new Error('Sound chunk offset mismatch');});return {offset:upload.offset};
 }
 if(op==='finish'){
  if(!upload||upload.offset!==upload.size)throw new Error('Sound upload incomplete');const item=upload;let info;
  withSDCard(root=>{item.file.flush();if(item.role==='audio')info=wavInfo(item.file);item.file.close();upload=undefined;root.move(folder+item.name+'.part',folder+item.name);});
  if(item.role==='audio'){
   if(typeof args.original!=='string'||!/^alarm-[a-f0-9]+-source\.mp3$/.test(args.original))throw new Error('Original MP3 is required');
   withSDCard(root=>root.status(folder+args.original));
   changeSettings(data=>{data.alarmSound={file:item.name,original:args.original,label:String(args.label||'カスタムアラーム').slice(0,100),...info};});
  }
  return {name:item.name,size:item.size,...info};
 }
 throw new Error('Unknown alarm sound operation');
}
export function stopAlarmSound(){stopPlayback?.();}
export async function playAlarmSound(robot,shouldStop=()=>false,seconds=0){
 const sound=getSettings().alarmSound;if(!sound)return false;
 let file,audio;const buffers=new Map(),free=[];let done=false,offset=44,pending=0,sequence=0;
 const stats=lastPlayback={state:'preparing',bytes:0,readMaxMs:0,queueStarvations:0,bufferBytes:32768,bufferCount:0};
 try{
  const info=withSDCard(root=>{file=root.openFile({path:folder+sound.file,mode:'r'});return wavInfo(file);});
  const end=44+Math.min(info.bytes,seconds>0?Math.floor(seconds*48000/2)*2:info.bytes);
  if(globalThis.amp)globalThis.amp.sampleRate=24000;
  audio=new AudioOut({streams:1,sampleRate:24000,numChannels:1,bitsPerSample:16});
  const capacity=audio.length(0),depth=Math.max(1,Math.min(4,Math.floor((capacity-1)/2)));
  for(let i=0;i<depth;i++)free.push(new SharedArrayBuffer(32768));stats.bufferCount=depth;
  return await new Promise((resolve,reject)=>{
   const finish=(error,stopped=false)=>{if(done)return;done=true;stats.state=error?'error':stopped?'stopped':'completed';stopPlayback=undefined;try{audio.close();}catch(_){}trace('[alarm-audio] result='+stats.state+' bytes='+stats.bytes+' read_max_ms='+stats.readMaxMs+' queue_empty='+stats.queueStarvations+'\n');error?reject(error):resolve(true);};
   stopPlayback=()=>finish(undefined,true);
   const enqueue=()=>{if(done)return;if(shouldStop()){finish(undefined,true);return;}if(offset>=end){if(!pending)finish();return;}const length=Math.min(32768,end-offset),pcm=free.pop();if(!pcm)throw new Error('Alarm PCM buffer unavailable');const start=Date.now();const count=withSDCard(()=>file.read(new Uint8Array(pcm,0,length),offset));stats.readMaxMs=Math.max(stats.readMaxMs,Date.now()-start);if(count!==length)throw new Error('Alarm SD read incomplete');offset+=length;stats.bytes+=length;const id=++sequence;buffers.set(id,pcm);pending++;audio.enqueue(0,AudioOut.RawSamples,pcm,1,0,length/2);audio.enqueue(0,AudioOut.Callback,id);};
   audio.callback=id=>{if(done)return;const pcm=buffers.get(id);buffers.delete(id);if(pcm)free.push(pcm);pending--;try{if(offset<end&&audio.length(0)===capacity)stats.queueStarvations++;enqueue();}catch(e){finish(e);}};
   audio.enqueue(0,AudioOut.Flush);audio.enqueue(0,AudioOut.Volume,Math.round(Math.min(robot.audio.volume,0.45)*256));
   try{for(let i=0;i<depth&&!done&&offset<end;i++)enqueue();stats.state='playing';audio.start();}catch(e){finish(e);}
  });
 }finally{stopPlayback=undefined;try{audio?.close();}catch(_){}try{if(file)withSDCard(()=>file.close());}catch(_){}buffers.clear();free.length=0;}
}
