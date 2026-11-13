import {mediaTrash,mediaFilePage} from 'archive-media-trash';
import {createLANMonitor} from 'archive-lan-monitor';
import AudioIn from 'embedded:io/audio/in';
import {TTS as MonitorTTS} from 'archive-offline-tts';
import {prepareRecognitionPCM} from 'archive-usb';
import {bootSpeechEnabled} from 'archive-offline-speech';
import {startCustomFace,faceCommand} from 'archive-custom-face';
import {startHistoryUI} from 'archive-history-ui';
import {startTimerUI} from 'archive-timer-ui';
import {createAlarmDance} from 'archive-alarm-motion';
import {captureFrame,screenCommand,showScreen} from 'archive-screen';
import {startDebugDrain,armDebugDrain,debugLogStatus} from 'archive-debug';
import {startChecks,checkStatus} from 'archive-checks';
import {Emotion} from 'face-state';
import {OfflinePolicy} from 'archive-offline-policy';
import {getSettings,changeSettings,randomHex} from 'archive-vault';
import {startLocalClock,setLocalTime,localClockStatus} from 'archive-local-clock';
import {startOffline,openOffline,closeOffline,offlineAction,offlineStatus} from 'archive-offline';
import {checkOllama} from 'archive-ollama';
import {startAISettings} from 'archive-ai-settings';
import Timer from 'timer';
import {checkGemini} from 'archive-gemini-check';
import {reconnectSavedWiFi} from 'archive-settings';
import {imageUploadCommand} from 'archive-image-upload';
import {startWiFiDisplay,wifiDisplayStatus} from 'archive-wifi-display';
import {analyzeJPEG,visionStatus} from 'archive-vision';
import {startAlarmSettings,openAlarmSettings,showRingingAlarm,hideRingingAlarm} from 'archive-alarm-ui';
import {alarmSoundCommand,playAlarmSound} from 'archive-alarm-sound';
import {startWeb,openControl,controlStatus} from 'archive-web';
import {microphoneIndicator,startDirectChat,directChatStatus,speakerList,selectSpeaker,configureChatProvider,setChatMode,setRecognitionMode,configureDirectChat,provisionDirectChat,testDirectConnection,pauseDirectChat,resumeDirectChat} from 'archive-direct-chat';
import {recordMemory,history,deviceHistory,currentSpeaker,users,saveUser,memoryStatus,importLegacy,memoryFileStatus,preserveInvalidMemory} from 'archive-memory';
import {startVolume,getVolume,setVolume,openVolume} from 'archive-volume';
import {acceptAudioChunk} from 'archive-audio-upload';
import {startSettings,openSettings,closeSettings,getSettingsStatus,vaultSelfTest,settingsHttpSelfTest,scanNearby} from 'archive-settings';
import {startDeviceTools,setAlarmDisplay,setAlarmMotion,callDeviceTool,listDeviceTools,reminderStatus} from 'archive-tools';
import Time from 'time';
import {getM5StackChanDriver} from 'm5stackchan-servo-driver';
import {readUSB,writeUSB,usbConnected,rebootUSB,convertRGB24,encodeJPEG} from 'archive-usb';
import Base64 from 'base64';
import config from 'mc/config';
import {HttpServerService, Response} from 'http-server-service';
import {withSDCard} from 'stackchan-sdcard';
import {bgr24,bitmapHeader,aviHeader,frameHeader,aviAudioHeader,audioFrameHeader} from 'archive-codec';

let sequence=0;
let busy=false;
let lastError='';
let audioUpload;
let server;
const folder='stackchan';
const safe=name=>typeof name==='string' && /^[a-z0-9-]+\.(bmp|avi|wav|jpg|json|mp3)$/.test(name);
function files(operation) {
  return withSDCard(root=>{
    try {root.createDirectory(folder);} catch (_) { if (!root.status(folder).isDirectory()) throw new Error('SD directory unavailable'); }
    return operation(root);
  });
}
function save(name,parts) {
  files(root=>{
    const file=root.openFile({path:`${folder}/${name}`,mode:'w'});
    try {let offset=0;for(const part of parts){file.write(part,offset);offset+=part.byteLength;}file.flush();}
    finally {file.close();}
  });
}
const id=()=>`${Date.now()}-${sequence++}`;
export function archiveTranscript(role,text,eventId,image,speakerId) {
  if(!text)return;
  try {
    const event={id:typeof eventId==='string'&&/^[a-z0-9-]{1,100}$/.test(eventId)?eventId:id(),role:role==='input'?'user':'assistant',text:String(text).slice(-4096),created:Date.now()};
    event.speakerId=speakerId===undefined?(directChatStatus().speaker?.id??null):speakerId;
    if(typeof image==='string'&&safe(image)&&image.endsWith('.jpg'))event.image=image;
    save(`chat-${event.id}.json`,[ArrayBuffer.fromString(JSON.stringify(event))]);
    try{recordMemory(event);}catch(_){trace('[memory] transcript database write failed\n');}
    return event;
  } catch(e) {lastError=String(e);trace('[archive] transcript could not be saved\n');}
}
// Preview frames stay in RAM: no SD writes or cloud image recognition.
async function cameraPreview(robot) {
 if(busy)throw new Error('本体で処理中です。会話や録画を停止してからお試しください');
 const paused=pauseDirectChat();
 if(busy){if(paused)resumeDirectChat();throw new Error('本体で処理中です');}
 busy=true;
 let frame;
 try{
  frame=await robot.camera.capture({width:176,height:144,imageType:'rgb565le'});
  if(!frame)throw new Error('カメラの画像を取得できませんでした');
  return encodeJPEG(frame.buffer,frame.width,frame.height,frame.imageType==='rgb565le');
 }finally{
  try{frame?.close?.();}finally{try{robot.camera.stop();}finally{busy=false;if(paused)resumeDirectChat();}}
 }
}
async function photo(robot,args={},fromConversation=false) {
 const wasBusy=busy;if(busy&&!fromConversation)throw new Error('Camera busy');busy=true;
 let frame,jpeg,result;
 try{
  frame=await robot.camera.capture({width:176,height:144,imageType:'rgb565le'});if(!frame)throw new Error('No camera frame');
  const tag=id(),name='photo-'+tag+'.jpg',image=name;
  jpeg=encodeJPEG(frame.buffer,frame.width,frame.height,frame.imageType==='rgb565le');save(image,[jpeg]);
  result={name,image,width:frame.width,height:frame.height};
 }finally{frame?.close?.();robot.camera.stop();busy=wasBusy;}
 if(args.analyze!==false)Object.assign(result,await describeImage(robot,result.name,jpeg,args.question));
 return result;
}

async function describeImage(robot,name,jpeg,question){
 const prompt=String(question||'この画像には何が写っていますか？').slice(0,1000);
 const speakerId=directChatStatus().speaker?.id??null;
 const input=archiveTranscript('input',prompt,undefined,name,speakerId);
 const analysis=await analyzeJPEG(jpeg,prompt);
 const answer=archiveTranscript('output',analysis.status==='complete'?analysis.text:'画像認識エラー: '+(analysis.error||'回答を取得できませんでした'),undefined,name,speakerId);
 if(analysis.status==='complete')robot.showBalloon(analysis.text);
 return {analysis,historySaved:!!input&&!!answer,messageIds:[input?.id,answer?.id]};
}

async function record(robot) {
  if(busy)throw new Error('Another capture is in progress');
  busy=true;
  const name=`video-${id()}.avi`,temporary=name.replace('.avi','.tmp'),fps=2;
  let count=0,offset=324,w=0,h=0,audioPromise,audioError;
  try {
    await robot.camera.start({width:176,height:144,imageType:'rgb565le'});
    const initial=await robot.camera.capture({width:176,height:144,imageType:'rgb565le'});
    if(!initial)throw new Error('No camera frame');
    w=initial.width;h=initial.height;initial.close?.();
    save(temporary,[aviAudioHeader(w,h,fps,0,{sampleRate:16000,channels:1,bitsPerSample:16,bytes:0})]);
    const started=Date.now();
    microphoneIndicator(true);audioPromise=robot.audio.record(5000).catch(e=>{audioError=e;return undefined;}).finally(()=>microphoneIndicator(false));
    trace('[archive] video and microphone recording begin\n');
    for(let i=0;i<10;i++){
      let frame;
      try {
        frame=await robot.camera.capture({width:w,height:h,imageType:'rgb565le'});
        if(!frame)throw new Error('No camera frame');
        const pixels=convertRGB24(frame.buffer,w,h,frame.imageType==='rgb565le');
        files(root=>{
          const file=root.openFile({path:`${folder}/${temporary}`,mode:'r+'});
          try {file.write(frameHeader(pixels.byteLength),offset);file.write(pixels,offset+8);file.flush();}
          finally {file.close();}
        });
        offset+=8+pixels.byteLength;count++;
      }finally {frame?.close?.();}
      const delay=started+(i+1)*500-Date.now();
      if(delay>0)await new Promise(resolve=>Timer.set(resolve,delay));
    }
    const wav=await audioPromise;
    if(!wav)throw audioError||new Error('Microphone recording failed');
    const view=new DataView(wav);
    if(wav.byteLength<44||view.getUint16(20,true)!==1)throw new Error('Unsupported microphone audio format');
    const pcm=new Uint8Array(wav,44);
    const audio={sampleRate:view.getUint32(24,true),channels:view.getUint16(22,true),bitsPerSample:view.getUint16(34,true),bytes:pcm.byteLength};
    files(root=>{
      const file=root.openFile({path:`${folder}/${temporary}`,mode:'r+'});
      try {file.write(audioFrameHeader(pcm.byteLength),offset);file.write(pcm,offset+8);file.write(aviAudioHeader(w,h,fps,count,audio),0);file.flush();}
      finally {file.close();}
      root.move(`${folder}/${temporary}`,`${folder}/${name}`);
    });
    trace('[archive] video with audio saved\n');
    return {name,frames:count,fps,audio:true,duration:5};
  }finally {
    if(audioPromise)await audioPromise;
    try {robot.camera.stop();}finally{busy=false;}
  }
}
async function recordAudio(robot) {
  if(busy)throw new Error('Another capture is in progress');
  busy=true;
  trace('[archive] audio recording begin (5000 ms)\n');
  try {
    microphoneIndicator(true);
    const wav=await robot.audio.record(5000);
    const name=`audio-${id()}.wav`;
    save(name,[wav]);
    trace('[archive] audio recording saved\n');
    return {name,duration:5,bytes:wav.byteLength};
  }finally{microphoneIndicator(false);busy=false;}
}
export function startArchive(robot) {
  let monitor,monitorVoice;
  // Register essential local UI before optional services that may fail at boot.
  // Each registration is isolated so one broken app cannot hide the others.
  try {
    startTimerUI(robot,{create:args=>callDeviceTool('timer_create',args),status:reminderStatus});
  } catch (error) { trace('[boot-ui] timer registration failed: '+String(error)+'\\n'); }
  try {
    startAlarmSettings(robot,{create:args=>callDeviceTool('alarm_create',args),list:()=>callDeviceTool('reminder_list'),cancel:id=>callDeviceTool('reminder_cancel',{id}),stop:()=>callDeviceTool('alarm_stop')});
    setAlarmDisplay({show:showRingingAlarm,close:hideRingingAlarm});
  } catch (error) { trace('[boot-ui] alarm registration failed: '+String(error)+'\\n'); }
  try {
    setAlarmMotion(stopped=>createAlarmDance(robot,{rotation:getM5StackChanDriver()?.lastKnownRotation,stopped}));
  } catch (error) { trace('[boot-ui] alarm motion setup failed: '+String(error)+'\\n'); }
  startDebugDrain();
  startLocalClock();
  startCustomFace(robot);
  startOffline(robot,{stopCloud:()=>{if(directChatStatus().recognitionMode)setRecognitionMode(false);if(directChatStatus().enabled)setChatMode(false);},claim:()=>{if(busy)return false;busy=true;return true;},release:()=>{busy=false;},tool:callDeviceTool,openAlarms:openAlarmSettings,startCloud:()=>setChatMode(true),openAI:()=>robot.ui.application.behavior.launchMiniApp('archive-ai-settings')});
  startHistoryUI(robot,{read:args=>{importLegacy();return deviceHistory(args);},people:()=>users({limit:50}).users.filter(p=>p.kind==='person'),current:currentSpeaker});
  startVolume(robot);
  startAISettings(robot,{status:directChatStatus,select:configureChatProvider,mode:setChatMode});
  startWiFiDisplay(robot);
  try{startSettings(robot);}catch(_){trace('[settings] initialization failed; USB remains available\n');}
  try{startDeviceTools(robot,()=>{if(monitor?.active){monitor.stopCurrent().catch(()=>{});return false;}if(directChatStatus().busy)pauseDirectChat();if(busy)return false;busy=true;return true;},()=>{busy=false;resumeDirectChat();});}catch(_){trace('[tools] initialization failed; USB remains available\n');}

  const token=config.archiveToken;
  if(!token)return;
  globalThis.stackchanArchiveTranscript=archiveTranscript;
  globalThis.abort=(reason,exception)=>{try{writeUSB(JSON.stringify({event:'fatal',reason:String(reason),detail:String(exception).slice(0,300)}));}catch(_){};rebootUSB();return true;};
  monitor=createLANMonitor({robot,now:()=>Date.now(),repeat:(fn,ms)=>Timer.repeat(fn,ms),cancel:id=>Timer.clear(id),token:()=>randomHex(16),
    claim(){
      if(offlineStatus().playing||reminderStatus().ringing||(busy&&!directChatStatus().busy))throw new Error('本体で処理中です');
      const paused=pauseDirectChat();
      if(busy){if(paused)resumeDirectChat();throw new Error('本体で処理中です');}
      closeOffline();busy=true;trace('[monitor] started\n');
    },
    release(){busy=false;resumeDirectChat();trace('[monitor] stopped\n');},
    log:message=>trace('[head-jog] '+message+'\n'),
    readHeadRotation:()=>new Promise((resolve,reject)=>{const driver=getM5StackChanDriver();if(!driver){reject(new Error('Motor unavailable'));return}driver.getRotation(result=>result.success?resolve({...result.value}):reject(new Error('Position unavailable')))}),
    createInput:options=>new AudioIn(options),
    convertPCM:(raw,channels)=>prepareRecognitionPCM(raw,0,raw.byteLength,channels),jpeg:encodeJPEG,
    cancelSpeech:()=>monitorVoice?.cancel(),
    async speak(text){
      let unlock;
      try{
        unlock=robot.audio.acquireExclusive();if(globalThis.amp)globalThis.amp.sampleRate=24000;
        monitorVoice??=new MonitorTTS({volume:robot.audio.volume,speed:80,onPlayed:power=>robot.face?.setMouthOpen(Math.min(1,power/2000)),onDone:()=>robot.face?.setMouthOpen(0)});
        await new Promise((resolve,reject)=>monitorVoice.stream(text,robot.audio.volume,error=>error?reject(error):resolve()));
      }finally{unlock?.();}
    }
  });
  async function execute(request){
    if(monitor.active&&!request.op.startsWith('/monitor/')&&!['/status','/volume','/chat/status','/files','/files/page','/network/status','/speaker/list','/settings/status','/reminders','/debug/status','/motor-status','/media/trash'].includes(request.op))throw new Error('動作確認を終了してから操作してください');
    const capture=['/face/save','/face/restore','/alarm-sound/preview','/motor/test','/motor/recover','/image/finish','/photo','/record','/audio','/chat-record'].includes(request.op);
    const paused=capture?pauseDirectChat():false;
    try{
      let result;
      if(request.op==='/monitor/start')result=monitor.start();
      else if(request.op==='/monitor/stop')result=await monitor.stop(request.args?.id);
      else if(request.op==='/monitor/status')result=monitor.status(request.args?.id);
      else if(request.op==='/monitor/audio')result=monitor.audio(request.args?.id,request.args?.enabled);
      else if(request.op==='/monitor/command')result=await monitor.command(request.args?.id,request.args?.action,request.args?.arguments||{});
      else if(request.op.startsWith('/face/'))result=faceCommand(request.op.slice(6),request.args||{});
      else if(request.op.startsWith('/image/')){
        if(request.op==='/image/finish'&&busy)throw new Error('本体で記録中です。少し待ってから送信してください');
        const action=request.op.slice(7),part=imageUploadCommand(action,request.args||{},Base64.decode);
        if(action==='finish'){const name='photo-'+id()+'.jpg';save(name,[part.buffer]);result={name,width:part.width,height:part.height,...await describeImage(robot,name,part.buffer,request.args?.question)};}else result=part;
      }
      else if(request.op==='/screen/begin')result=await captureFrame(robot);
      else if(request.op==='/screen/read')result={base64:Base64.encode(screenCommand('read',request.args))};
      else if(request.op==='/screen/tap'){
        const {x,y}=request.args||{};
        if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=320||y<0||y>=240)throw new Error('Invalid touch coordinates');
        if(directChatStatus().enabled||(busy&&!reminderStatus().ringing))throw new Error('本体が使用中です');
        const view=globalThis.screen.context;
        view.onTouchBegan(0,x,y,Time.ticks);await new Promise(resolve=>Timer.set(resolve,60));view.onTouchEnded(0,x,y,Time.ticks);
        result={tapped:true};
      }
      else if(request.op==='/screen/show'){if(busy||directChatStatus().enabled||reminderStatus().ringing)throw new Error('本体の操作が終わってから画面を確認してください');if(request.args?.scene!=='balloon-test')closeOffline();result=showScreen(robot,request.args?.scene);await new Promise(resolve=>Timer.set(resolve,150));}
      else if(request.op==='/debug/status')result=debugLogStatus();
      else if(request.op==='/offline/auto')result=autoOffline(request.args?.enabled);
      else if(request.op==='/offline/status')result=offlineStatus();
      else if(request.op==='/offline/open')result=openOffline();
      else if(request.op==='/offline/action')result=await offlineAction(request.args?.action);
      else if(request.op==='/clock/status')result=localClockStatus();
      else if(request.op==='/alarms/open')result=openAlarmSettings();
      else if(request.op.startsWith('/alarm-sound/')&&request.op!=='/alarm-sound/preview')result=alarmSoundCommand(request.op.slice('/alarm-sound/'.length),request.args);
      else if(request.op==='/alarm-sound/preview'){busy=true;try{result={played:await playAlarmSound(robot,()=>false,Math.max(1,Math.min(5,Number(request.args?.seconds)||2)))};}finally{busy=false;}}
      else if(request.op==='/volume'){result=request.args?.percent===undefined?getVolume():setVolume(Number(request.args.percent),request.args.preview===true&&!monitor.active);}
      else if(request.op==='/network/open')result=openControl(request.args?.mode);
      else if(request.op==='/vision/status')result=visionStatus();
      else if(request.op==='/network/status')result=controlStatus();
      else if(request.op==='/wifi/reconnect')result=reconnectSavedWiFi();
      else if(request.op==='/chat/ollama-test')result=await checkOllama();
      else if(request.op==='/chat/gemini-test')result=await checkGemini();
      else if(request.op==='/speaker/list')result=speakerList();
      else if(request.op==='/speaker/select')result=selectSpeaker(request.args||{});
      else if(request.op==='/speaker/register')result=selectSpeaker(request.args||{},true);
      else if(request.op==='/chat/provider')result=configureChatProvider(request.args);
      else if(request.op==='/chat/status')result=directChatStatus();
      else if(request.op==='/chat/configure')result=configureDirectChat(request.args);
      else if(request.op==='/chat/provision')result=await provisionDirectChat();
      else if(request.op==='/chat/test')result=await testDirectConnection(request.args?.provider,{playback:request.args?.playback===true});
      else if(request.op==='/chat/start')result=setChatMode(true);
      else if(request.op==='/chat/stop')result=setChatMode(false);
      else if(request.op==='/recognition/mode')result=setRecognitionMode(request.args?.enabled);
      else if(request.op==='/memory/history')result=history(request.args);
      else if(request.op==='/memory/users')result=users(request.args);
      else if(request.op==='/memory/save-user')result=saveUser(request.args);
      else if(request.op==='/memory/status')result=memoryStatus();
      else if(request.op==='/memory/file-status')result=memoryFileStatus();
      else if(request.op==='/memory/preserve-invalid')result=preserveInvalidMemory();
      else if(request.op==='/memory/import'){importLegacy();result=memoryStatus();}
      else if(request.op==='/volume/open')result=openVolume();
      else if(request.op==='/time'){const epoch=Number(request.args?.epoch);if(!Number.isSafeInteger(epoch)||epoch<1700000000000)throw new Error('Invalid time');setLocalTime(epoch);result={now:Date.now()};}
      else if(request.op==='/settings/open'){
        robot.ui.application.behavior.closeDrawer?.();
        if(!robot.ui.application.behavior.launchMiniApp('wifi-settings'))throw new Error('Settings screen could not open');
        result=getSettingsStatus();
      }else if(request.op==='/settings/close'){
        closeSettings();robot.ui.showFace();result=getSettingsStatus();
      }else if(request.op==='/settings/status')result=getSettingsStatus();
      else if(request.op==='/settings/self-test')result=vaultSelfTest();
      else if(request.op==='/settings/http-test')result=await settingsHttpSelfTest();
      else if(request.op==='/settings/scan-test')result={count:(await scanNearby()).length};
      else if(request.op==='/tools/list')result={tools:listDeviceTools()};
      else if(request.op==='/tools/call')result=await callDeviceTool(request.args?.name,request.args?.arguments??{});
      else if(request.op==='/reminders')result=reminderStatus();
      else if(request.op==='/motor/test'){
        const driver=getM5StackChanDriver();if(!driver)throw new Error('Motor driver unavailable');
        const diagnostics=()=>new Promise(resolve=>driver.getDiagnostics(resolve));
        const before=await diagnostics(),base={...(driver.lastKnownRotation||robot.pose.body.rotation)},pose=robot.pose.body;
        const targets=request.args?.large===true?[{...base,y:base.y+.3},{...base,y:base.y-.3},{...base,p:base.p+.14},{...base,p:base.p-.14}]:[{...base,y:base.y+(base.y>0?-.12:.12)}];
        const samples=[];try{await robot.setTorque(true);for(const rotation of targets){await robot.setPose({...pose,rotation},.3);await new Promise(resolve=>Timer.set(resolve,450));samples.push(await diagnostics());}result={before,samples,moved:samples.some(d=>(before.pan?.success&&d.pan?.success&&Math.abs(before.pan.value.position-d.pan.value.position)>2)||(before.tilt?.success&&d.tilt?.success&&Math.abs(before.tilt.value.position-d.tilt.value.position)>2))};}
        finally{await robot.setPose({...pose,rotation:base},.4);await new Promise(resolve=>Timer.set(resolve,550));await robot.setTorque(false);}
      }
      else if(request.op==='/motor/recover'){const driver=getM5StackChanDriver();if(!driver)throw new Error('Motor driver unavailable');await robot.setTorque(false);result=await new Promise(resolve=>driver.recoverPower(resolve));}
      else if(request.op==='/motor-status'){const driver=getM5StackChanDriver();result=driver?await new Promise(resolve=>driver.getDiagnostics(resolve)):{error:'M5StackChan driver unavailable'};}
      else if(request.op==='/transcript'){
        result=archiveTranscript(request.args?.role,String(request.args?.text??'').slice(0,4096),request.args?.eventId);
        if(!result)throw new Error('Transcript SD write failed');
      }else if(request.op==='/speak-begin'){
        const size=Number(request.args?.size);
        if(!Number.isInteger(size)||size<44||size>1200044||busy)throw new Error('Invalid or busy audio upload');
        audioUpload={buffer:new ArrayBuffer(size),offset:0,time:Date.now()};
        result={ok:true};
      }else if(request.op==='/speak-chunk'){
        const bytes=Base64.decode(String(request.args?.data??''));
        result=acceptAudioChunk(audioUpload,Number(request.args?.offset),bytes);
      }else if(request.op==='/speak-cancel'){
        audioUpload=undefined;result={ok:true};
      }else if(request.op==='/speak-play'){
        if(!audioUpload||audioUpload.offset!==audioUpload.buffer.byteLength||busy)throw new Error('Audio upload incomplete');
        const buffer=audioUpload.buffer;audioUpload=undefined;busy=true;
        try{trace('[archive] conversation playback start\n');result={played:await robot.audio.playAudio(buffer)};}
        finally{busy=false;trace('[archive] conversation playback done\n');}
      }
      else if(request.op==='/chat-record'){await robot.audio.tone(880,100,Math.min(robot.audio.volume,0.25));result=await recordAudio(robot);}
      else if(request.op==='/audio')result=await recordAudio(robot);
      else if(request.op==='/photo')result=await photo(robot,request.args);
      else if(request.op==='/record')result=await record(robot);
      else if(request.op==='/status'){
        let sd=false;try{files(()=>{});sd=true;}catch(e){lastError=String(e);}
        result={sd,camera:robot.camera.available!==false,busy:busy&&!directChatStatus().busy,chat:directChatStatus(),lastError,headTouch:!!robot.touchPanel,headSample:Array.from(robot.touchPanel?.sample??[]),transport:'usb+wifi',petting:'m5stack/StackChan',wifi:getSettingsStatus(),wifiDisplay:wifiDisplayStatus(),firmware:'stack-chan + M5Stack petting + USB archive'};
      }else if(['/media/delete','/media/restore','/media/trash'].includes(request.op)){
        if(busy&&!directChatStatus().busy&&request.op!=='/media/trash')throw new Error('撮影・録音が終わってから操作してください');
        result=files(root=>mediaTrash(root,request.op==='/media/trash'?'list':request.op.slice(7),request.args||{}));
      }else if(request.op==='/files/page'){
        result=files(root=>mediaFilePage(root,folder,safe,request.args||{}));
      }else if(request.op==='/files'){
        if(busy&&!directChatStatus().busy)throw new Error('Camera busy');
        result=files(root=>{
          const list=[];for(const name of root.scan(folder)){
            if(!safe(name))continue;
            const stat=root.status(`${folder}/${name}`);
            if(stat.isFile())list.push({name,size:stat.size});
          }
          return list;
        });
      }else if(request.op==='/file'){
        const {name,offset=0,length=8192}=request.args||{};
        if(!safe(name)||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(length)||length<1||length>8192)throw new Error('Invalid file range');
        result=files(root=>{
          const f=root.openFile({path:`${folder}/${name}`,mode:'r'});
          try{return {base64:Base64.encode(f.read(Math.min(length,Math.max(0,f.status().size-offset)),offset))};}finally{f.close();}
        });
      }else throw new Error('Unknown operation');
      return result;
    }finally{if(paused)resumeDirectChat();}
  }
  let usbBusy=false;
  let usbInitError=false;
  Timer.repeat(async()=>{
    if(usbBusy)return;
    if(audioUpload&&Date.now()-audioUpload.time>120000)audioUpload=undefined;
    let raw;
    try{raw=readUSB();}catch(e){if(!usbInitError){trace('[archive] USB init failed: '+String(e)+'\n');usbInitError=true;}return;}
    if(!raw)return;
    let request;
    try{request=JSON.parse(raw);}catch(_){return;}
    if(!Number.isInteger(request.id)||request.token!==token)return;
    armDebugDrain();
    usbBusy=true;
    try {
      const result=await execute(request);
      writeUSB(JSON.stringify({id:request.id,result}));
    }catch(e){lastError=String(e);writeUSB(JSON.stringify({id:request.id,error:lastError}));}
    finally{usbBusy=false;}
  },5);

  try{startDirectChat(robot,archiveTranscript,()=>{if(busy||visionStatus().working)return false;busy=true;return true;},()=>{busy=false;},args=>photo(robot,{...args,analyze:true},true),on=>{if(on){
    // Preserve the user's ON choice while boot/offline speech owns the audio device.
    // The regular chat retry loop will connect after the audio lease is released.
    if(offlineStatus().playing)return;
    closeOffline();
  }},async()=>{if(bootSpeechEnabled(getSettings())){trace('[boot] speaking name\n');await offlineAction('boot');robot.hideBalloon();}});}catch(_){trace('[direct-chat] initialization unavailable\n');}
  startChecks(robot,{
    prepare(){if((busy&&!directChatStatus().busy)||offlineStatus().playing||reminderStatus().ringing)throw new Error('busy');if(directChatStatus().enabled)setChatMode(false);closeOffline();},
    async test(kind,report,stopped){
      const wait=ms=>new Promise(resolve=>Timer.set(resolve,ms));
      if(kind==='recognition'){
        if(!getSettingsStatus().connected||!directChatStatus().configured)throw new Error('network');
        let result;try{result=await testDirectConnection(directChatStatus().provider,{recognition:true,progress:report,cancelled:stopped});}catch(error){if(String(error?.message).includes('timed out'))throw new Error('speech-timeout');throw error;}
        return result.transcript?'認識: '+result.transcript:'言葉を認識できませんでした';
      }
      if(kind==='audio'){report('本体の音声を再生します');await offlineAction('hello',{bottom:80});return '声が聞こえたか確認してください（現在の音量）';}
      if(busy)throw new Error('busy');busy=true;
      const base={...(getM5StackChanDriver()?.lastKnownRotation||robot.pose.body.rotation)},pose=robot.pose.body;
      try{
        if(kind==='emotion'){
          for(const [emotion,name] of [[Emotion.NEUTRAL,'通常'],[Emotion.HAPPY,'うれしい'],[Emotion.ANGRY,'おこる'],[Emotion.SAD,'かなしい'],[Emotion.SLEEPY,'ねむい'],[Emotion.HOT,'あつい']]){if(stopped())break;report('表情: '+name);robot.setEmotion(emotion);await wait(1200);}
          return '表情が順番に変わったか確認してください';
        }
        if(kind==='servo'){
          robot.lookAway();await robot.setTorque(true);
          for(const [name,rotation] of [['左',{y:.3,p:0,r:0}],['右',{y:-.3,p:0,r:0}],['上',{y:0,p:-.15,r:0}],['下',{y:0,p:.12,r:0}]]){if(stopped())break;report('サーボ: '+name);await robot.setPose({...pose,rotation},.5);await wait(800);}
          return '左右・上下へ動いたか確認してください';
        }
        if(kind==='led'){
          const name=Object.keys(robot.led)[0];if(!name)throw new Error('unavailable');
          for(const [label,r,g,b] of [['赤',96,0,0],['緑',0,96,0],['青',0,0,96]]){if(stopped())break;report('LED: '+label);robot.lightOn(name,r,g,b);await wait(900);}
          if(!stopped()){report('LED: 虹色');robot.lightRainbow(name);await wait(1800);}
          return '赤・緑・青・虹色に光ったか確認してください';
        }
      }finally{
        try{if(kind==='emotion')robot.setEmotion(Emotion.NEUTRAL);if(kind==='led')for(const name of Object.keys(robot.led))robot.lightOff(name);if(kind==='servo'){try{await robot.setPose({...pose,rotation:base},.5);await wait(650);}finally{await robot.setTorque(false);}}}finally{busy=false;}
      }
    }
  });
  const offlinePolicy=new OfflinePolicy();
  let hadOnlineConnection=usbConnected()||getSettingsStatus().connected;
  const autoOffline=value=>{
    if(typeof value==='boolean'){changeSettings(s=>{s.autoOffline=value;});offlinePolicy.reset();}
    return {enabled:getSettings().autoOffline!==false,usb:usbConnected(),wifi:getSettingsStatus().connected,active:offlinePolicy.entered};
  };
  Timer.repeat(()=>{
    try{
      const connection=autoOffline(),network=getSettingsStatus();
      const online=connection.usb||connection.wifi;
      if(online&&!hadOnlineConnection)closeOffline();
      hadOnlineConnection=online;
      if(!offlinePolicy.observe({...connection,setup:network.setupActive||checkStatus().running,busy:(busy&&!directChatStatus().busy)||offlineStatus().playing}))return;
      openOffline();offlinePolicy.enteredOffline();trace('[offline] automatic mode: USB and Wi-Fi disconnected\n');
    }catch(_){offlinePolicy.absent=0;}
  },1000);
  startWeb(robot,{
    autoOffline,openOffline,closeOffline,
    bootSpeech(value){if(typeof value==='boolean')changeSettings(s=>{s.bootSpeak=value});return bootSpeechEnabled(getSettings());},
    diagnostics:()=>({wifi:getSettingsStatus(),signal:wifiDisplayStatus(),ai:directChatStatus(),volume:getVolume(),connection:autoOffline(),local:offlineStatus(),clock:localClockStatus()}),
    execute,
    preview:id=>id?monitor.frame(id):cameraPreview(robot),
    monitorAudio:id=>monitor.readAudio(id),
    read(name,offset,length,whole=false){
      if(!safe(name)||busy&&!directChatStatus().busy)throw new Error('Media unavailable');
      return files(root=>{const f=root.openFile({path:folder+'/'+name,mode:'r'});try{const size=f.status().size;if(whole&&size>length)throw new Error('Media file too large');return f.read(Math.min(length,Math.max(0,size-offset)),offset);}finally{f.close();}});
    },
    messages(){importLegacy();const rows=history({limit:10}).items;return files(root=>rows.map(row=>{if(!row.image)return row;try{if(root.status(folder+'/'+row.image).isFile())return row;}catch(_){}return {...row,image:undefined,mediaDeleted:true};}));}
  },token);
  trace('[archive] USB and standalone network control ready\n');
}
