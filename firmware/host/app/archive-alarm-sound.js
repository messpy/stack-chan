import AudioOut from 'embedded:io/audio/out';
import Timer from 'timer';
import Base64 from 'base64';
import {withSDCard} from 'stackchan-sdcard';
import {getSettings,changeSettings,randomHex} from 'archive-vault';
let upload,stopPlayback,lastPlayback;
const folder='stackchan/';
const validTarget=value=>['alarm','timer','both'].includes(value);
export function selectedReminderSound(kind='alarm'){
 const settings=getSettings();
 if(kind==='timer')return 'timerSound' in settings?settings.timerSound||null:settings.alarmSound||null;
 return settings.alarmSound||null;
}
export function alarmSoundStatus(){
 return {
  sound:selectedReminderSound('alarm'),
  timerSound:selectedReminderSound('timer'),
  playback:lastPlayback||null,
  upload:upload?{role:upload.role,offset:upload.offset,size:upload.size}:null,
 };
}
function cancelUpload(){
 if(!upload)return false;
 const item=upload;upload=undefined;
 try{withSDCard(root=>{
  try{item.file.close();}catch(_){}
  try{root.delete(folder+item.name+'.part');}catch(_){}
 });}catch(_){}
 return true;
}
function wavInfo(file){const b=file.read(44,0),v=new DataView(b);if(b.byteLength!==44||v.getUint32(0,false)!==0x52494646||v.getUint32(8,false)!==0x57415645||v.getUint32(36,false)!==0x64617461||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint16(34,true)!==16||v.getUint32(24,true)!==24000)throw new Error('Expected 24kHz mono PCM WAV');const bytes=v.getUint32(40,true);if(bytes<2||bytes%2||bytes+44!==file.status().size)throw new Error('Invalid WAV size');return {bytes,sampleRate:24000,duration:bytes/48000};}
const libraryName=value=>typeof value==='string'&&/^alarm-[a-f0-9]+-audio\.wav$/.test(value);
function librarySound(name,label,original){
 if(!libraryName(name))throw new Error('保存済み音声を選んでください');
 let info;
 withSDCard(root=>{const file=root.openFile({path:folder+name,mode:'r'});try{info=wavInfo(file);}finally{file.close();}});
 const settings=getSettings();
 const matches=[...(settings.audioLibrary||[]),settings.alarmSound,settings.timerSound].filter(item=>item?.file===name);
 const saved=matches[0];
 if(original!==undefined){
  if(typeof original!=='string'||!/^alarm-[a-f0-9]+-source\.mp3$/.test(original))throw new Error('Invalid original sound');
  withSDCard(root=>{if(!root.status(folder+original).isFile())throw new Error('Original MP3 missing');});
 }
 const source=original??matches.find(item=>item.original)?.original;
 return {file:name,label:String(label||saved?.label||name).slice(0,100),...(source?{original:source}:{}),...info};
}
function selectSound(sound,target){
 if(!validTarget(target))throw new Error('通知音の設定先を選んでください');
 changeSettings(data=>{
  if(target==='alarm'||target==='both')data.alarmSound=sound;
  if(target==='timer'||target==='both')data.timerSound=sound;
 });
}
function scanSounds(){
 const labels=new Map((getSettings().audioLibrary||[]).map(item=>[item.file,item.label]));
 const items=[];
 withSDCard(root=>{for(const name of root.scan('stackchan')){
  if(!libraryName(name))continue;
  const status=root.status(folder+name);
  if(status.isFile())items.push({file:name,label:labels.get(name)||name,size:status.size});
  if(items.length>=100)break;
 }});
 return {items};
}
function listSounds(){
 const settings=getSettings(),rows=new Map();
 for(const item of [settings.alarmSound,settings.timerSound,...(settings.audioLibrary||[])]){
  if(!item||!libraryName(item.file))continue;
  rows.set(item.file,{...rows.get(item.file),...item});
 }
 return {items:[...rows.values()].map(item=>({file:item.file,label:item.label||item.file,size:item.size??(Number.isInteger(item.bytes)?item.bytes+44:null)}))};
}
export function alarmSoundCommand(op,args={}){
 if(op==='status')return alarmSoundStatus();
 if(op==='list')return listSounds();
 if(op==='discover'){
  if(upload||stopPlayback)throw new Error('音声の転送・再生が終わってから再検出してください');
  const old=new Map((getSettings().audioLibrary||[]).map(item=>[item.file,item]));
  const found=scanSounds();
  changeSettings(data=>{data.audioLibrary=found.items.map(item=>({...old.get(item.file),...item}));});
  return listSounds();
 }
 if(op==='select'){const sound=librarySound(args.name,args.label,args.original);selectSound(sound,args.target);return alarmSoundStatus();}
 if(op==='delete'){
  if(args.confirmed!==true||!libraryName(args.name))throw new Error('削除する音声を確認してください');
  if(stopPlayback)throw new Error('再生が終わってから削除してください');
  if([selectedReminderSound('alarm'),selectedReminderSound('timer')].some(sound=>sound?.file===args.name))throw new Error('通知音に使用中です。設定を変更してから削除してください');
  withSDCard(root=>{if(!root.status(folder+args.name).isFile())throw new Error('音声がありません');root.delete(folder+args.name);});
  changeSettings(data=>{data.audioLibrary=(data.audioLibrary||[]).filter(item=>item.file!==args.name);});
  return {deleted:true};
 }
 if(op==='cancel')return {cancelled:cancelUpload()};
 if(op==='reset'){
  const target=args.target;
  if(!validTarget(target))throw new Error('Invalid sound target');
  changeSettings(data=>{
   if(target==='alarm'||target==='both')data.alarmSound=null;
   if(target==='timer'||target==='both')data.timerSound=null;
  });
  return alarmSoundStatus();
 }
 if(op==='begin'){
  if(!['source','audio'].includes(args.role)||!Number.isSafeInteger(args.size)||args.size<44||args.size>32000000)throw new Error('Invalid sound upload');
  if(args.role==='audio'&&listSounds().items.length>=100)throw new Error('保存済み音声は100件までです。不要な音声を削除してください');
  if(upload&&Date.now()-upload.time>120000)cancelUpload();
  if(upload)throw new Error('別の音声をアップロード中です。完了または中止してください');
  const name='alarm-'+randomHex().slice(0,16)+'-'+(args.role==='source'?'source.mp3':'audio.wav');
  withSDCard(root=>{
   try{root.createDirectory('stackchan');}catch(_){}
   upload={name,role:args.role,size:args.size,offset:0,time:Date.now(),file:root.openFile({path:folder+name+'.part',mode:'w+'})};
  });
  return {offset:0};
 }
 if(op==='chunk'){
  if(!upload||typeof args.data!=='string'||args.data.length>11000)throw new Error('Sound upload unavailable');
  const bytes=Base64.decode(args.data),offset=Number(args.offset);if(!Number.isSafeInteger(offset)||offset<0||!bytes.byteLength||bytes.byteLength>8192||offset+bytes.byteLength>upload.size)throw new Error('Invalid sound chunk');
  withSDCard(()=>{
   if(offset===upload.offset){upload.file.write(bytes,offset);upload.offset+=bytes.byteLength;}
   else if(offset+bytes.byteLength<=upload.offset){
    const previous=new Uint8Array(upload.file.read(bytes.byteLength,offset)),next=new Uint8Array(bytes);
    for(let i=0;i<next.length;i++)if(previous[i]!==next[i])throw new Error('Sound retry mismatch');
   }else throw new Error('Sound chunk offset mismatch');
  });
  upload.time=Date.now();
  return {offset:upload.offset};
 }
 if(op==='finish'){
  if(!upload||upload.offset!==upload.size)throw new Error('Sound upload incomplete');
  const item=upload;let info;
  const target=args.target||'alarm';
  if(item.role==='audio'&&target!=='library'&&!validTarget(target))throw new Error('Invalid sound target');
  const original=args.original;
  if(item.role==='audio'&&original!==undefined){
   if(typeof original!=='string'||!/^alarm-[a-f0-9]+-source\.mp3$/.test(original))
    throw new Error('Invalid original sound');
   withSDCard(root=>{if(!root.status(folder+original).isFile())throw new Error('Original MP3 missing');});
  }
  try {
   withSDCard(root=>{
    item.file.flush();
    if(item.role==='audio')info=wavInfo(item.file);
    item.file.close();upload=undefined;
    root.move(folder+item.name+'.part',folder+item.name);
   });
  } catch(error) {
   if(upload===item)cancelUpload();
   throw error;
  }
  if(item.role==='audio'){
   const label=String(args.label||'カスタム通知音').slice(0,100);
   const sound={file:item.name,label,...(original?{original}:{}),...info};
   changeSettings(data=>{
    data.audioLibrary=[...(data.audioLibrary||[]).filter(item=>item.file!==sound.file),{file:sound.file,label:sound.label,size:item.size,...(sound.original?{original:sound.original}:{})}].slice(-100);
    if(target==='alarm'||target==='both')data.alarmSound=sound;
    if(target==='timer'||target==='both')data.timerSound=sound;
   });
  }
  return {name:item.name,size:item.size,...info};
 }
 throw new Error('Unknown alarm sound operation');
}
export function stopAlarmSound(){stopPlayback?.();}
export async function playAlarmSound(robot,shouldStop=()=>false,seconds=0,kind='alarm',name){
 const sound=name?librarySound(name):selectedReminderSound(kind);if(!sound)return false;
 // Four SDK-sized chunks (~341ms), bounded to protect the CoreS3 internal RAM.
 // SD prefetch is separate from the real-time AudioOut writable callback.
 const BUFFER_BYTES=4*4092,REFILL_BYTES=8192,BYTES_PER_SECOND=48000;
 let file,audio,refillTimer,drainTimer;
 let done=false,sourceOffset=44,head=0,tail=0,queued=0,writable=0,capacity=0;
 let draining=false,padding=0,lastWritableAt=0,starving=false;
 const ring=new Uint8Array(BUFFER_BYTES),silence=new Uint8Array(1024);
 const stats=lastPlayback={state:'preparing',bytes:0,readMaxMs:0,callbackGapMaxMs:0,
   queueStarvations:0,bufferBytes:ring.byteLength,bufferCount:1,paddingBytes:0,drain:'pending'};
 try{
  const info=withSDCard(root=>{file=root.openFile({path:folder+sound.file,mode:'r'});return wavInfo(file);});
  const end=44+Math.min(info.bytes,seconds>0?Math.floor(seconds*BYTES_PER_SECOND/2)*2:info.bytes);
  if(globalThis.amp)globalThis.amp.sampleRate=24000;
  return await new Promise((resolve,reject)=>{
   const finish=(error,stopped=false)=>{
    if(done)return;done=true;
    stats.state=error?'error':stopped?'stopped':'completed';
    stats.drain=error?'failed':stopped?'cancelled':'completed';
    stopPlayback=undefined;
    if(refillTimer!==undefined){Timer.clear(refillTimer);refillTimer=undefined;}
    if(drainTimer!==undefined){Timer.clear(drainTimer);drainTimer=undefined;}
    // Native audio handles must only close after onWritable returns.
    Timer.set(()=>{
     try{audio?.stop();}catch(_){}
     try{audio?.close();}catch(_){}
     audio=undefined;
     trace('[alarm-audio] result='+stats.state+' bytes='+stats.bytes+' read_max_ms='+stats.readMaxMs+
       ' callback_gap_max_ms='+stats.callbackGapMaxMs+' feed_empty='+stats.queueStarvations+
       ' padding_bytes='+stats.paddingBytes+'\n');
     error?reject(error):resolve(true);
    },0);
   };
   const refill=()=>{
    if(done||sourceOffset>=end||queued===ring.byteLength)return false;
    const length=Math.min(REFILL_BYTES,ring.byteLength-queued,ring.byteLength-tail,end-sourceOffset)&~1;
    if(!length)return false;
    const now=Date.now(),view=ring.subarray(tail,tail+length);
    // SD I/O, including CoreS3 GPIO35 bus handoff, never runs inside onWritable.
    const count=withSDCard(()=>file.read(view,sourceOffset));
    stats.readMaxMs=Math.max(stats.readMaxMs,Date.now()-now);
    if(count!==length)throw new Error('Alarm SD read incomplete');
    tail=(tail+length)%ring.byteLength;queued+=length;sourceOffset+=length;
    return true;
   };
   const pump=()=>{
    if(done||!audio||!capacity)return;
    while(writable>=2&&queued>=2){
     const length=Math.min(writable,queued,ring.byteLength-head,REFILL_BYTES)&~1;
     if(!length)break;
     audio.write(ring.subarray(head,head+length));
     head=(head+length)%ring.byteLength;queued-=length;writable-=length;stats.bytes+=length;
    }
    if(!draining&&sourceOffset>=end&&queued===0){
     draining=true;stats.drain='padding';
     // Match upstream WebRadioAudioOut.drain(): flush staging and keep
     // one entire FIFO of silence until the original samples have played.
     padding=capacity+((capacity-(stats.bytes%capacity))%capacity);
     drainTimer=Timer.set(()=>finish(new Error('Alarm audio drain timed out')),5000);
    }
    while(draining&&padding>=2&&writable>=2){
     const length=Math.min(padding,writable,silence.length)&~1;
     if(!length)break;
     audio.write(silence.subarray(0,length));
     writable-=length;padding-=length;stats.paddingBytes+=length;
    }
    // Writable capacity reports DMA completion, not just FIFO writes.
    if(draining&&padding===0&&writable>=capacity)finish();
   };
   stopPlayback=()=>finish(undefined,true);
   try{
    // Prime the bounded ring before I2S, without storing an entire audio file.
    while(sourceOffset<end&&queued<ring.byteLength){if(!refill())break;}
    audio=new AudioOut({sampleRate:24000,channels:1,bitsPerSample:16,onWritable(size){
     if(done)return;
     try{
      const now=Date.now();
      if(lastWritableAt)stats.callbackGapMaxMs=Math.max(stats.callbackGapMaxMs,now-lastWritableAt);
      lastWritableAt=now;
      writable=size&~1;capacity=Math.max(capacity,writable);
      if(!draining&&sourceOffset<end&&queued===0&&writable>=capacity){
       if(!starving){stats.queueStarvations++;starving=true;}
      }else if(queued>0)starving=false;
      pump();
     }catch(error){finish(error);}
    }});
    audio.volume=Math.min(robot.audio.volume,0.45);
    // One SD read per 20ms tick at most. The writable callback only copies RAM.
    refillTimer=Timer.repeat(()=>{
     if(done)return;
     try{
      if(shouldStop()){finish(undefined,true);return;}
      if(queued<=ring.byteLength-REFILL_BYTES&&sourceOffset<end)refill();
      pump();
     }catch(error){finish(error);}
    },20);
    stats.state='playing';
    audio.start();
   }catch(error){finish(error);}
  });
 }finally{
  stopPlayback=undefined;
  try{audio?.stop();}catch(_){}
  try{audio?.close();}catch(_){}
  try{if(file)withSDCard(()=>file.close());}catch(_){}
 }
}
