import {heapStatus,initDebugLog,pushDebugLog,popDebugLog,debugLogStatus,usbConnected,writeDebugUSB} from 'archive-usb';
import Timer from 'timer';
let installed=false,draining=false,armed=false;
export function armDebugDrain(){armed=true;}
export function installDebugLog(){
  if(installed)return;
  initDebugLog();installed=true;
  const old=globalThis.trace;
  const trace=(...parts)=>{const text=parts.map(String).join('');pushDebugLog(text);};
  // Preserve the SDK's optional trace helpers without routing normal text to its disabled release console.
  for(const key of ['left','right','center'])if(old?.[key])trace[key]=old[key].bind(old);
  globalThis.trace=trace;
  trace('[debug] release logging enabled\n');
}
export function startDebugDrain(){
  if(draining)return;draining=true;
  let pending,nextMemory=0;
  Timer.repeat(()=>{
    try{
      if(!usbConnected()){armed=false;return;}
      if(!armed)return;
      if(Date.now()>=nextMemory){
        nextMemory=Date.now()+30000;
        const m=heapStatus();
        trace('[heap] nativeStackMinimumFree='+m.nativeStackMinimumFree+' internalFree='+m.internalFree+' internalMinimum='+m.internalMinimum+' internalLargest='+m.internalLargest+' psramFree='+m.psramFree+' psramMinimum='+m.psramMinimum+' psramLargest='+m.psramLargest+'\n');
      }
      for(let i=0;i<8;i++){
        pending??=popDebugLog();if(pending===undefined)break;
        let end=Math.min(400,pending.length);
        const last=pending.charCodeAt(end-1);if(last>=0xd800&&last<=0xdbff)end--;
        if(!writeDebugUSB(JSON.stringify({event:'debug',lines:[pending.slice(0,end)],status:debugLogStatus()})))break;
        pending=pending.slice(end)||undefined;
      }
    }catch(_){}
  },100);
}
// Opt-in, volatile conversation diagnostics. Never store transcripts on-device.
let conversationTextEnabled=false;
export function configureConversationLog(enabled){
  if(enabled!==undefined){
    if(typeof enabled!=='boolean')throw new Error('Expected boolean enabled');
    if(enabled&&!usbConnected())throw new Error('USB connection required for transcript logging');
    conversationTextEnabled=enabled;
    if(enabled)armDebugDrain();
  }
  return {enabled:conversationTextEnabled&&usbConnected(),usb:usbConnected(),volatile:true,maxTextChars:4096};
}
export function traceConversation(kind,value){
  if(!conversationTextEnabled)return;
  if(!usbConnected()){conversationTextEnabled=false;return;}
  const source=String(value??''),text=source.slice(0,4096).replace(/[\u0000-\u001f\u007f]/g,' ');
  const label=String(kind).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,24)||'EVENT';
  const now=Date.now();
  if(!text){trace('[dialog] '+now+' '+label+'\n');return;}
  let part=0,at=0;
  while(at<text.length){
    let end=Math.min(at+140,text.length);
    if(end<text.length){const ch=text.charCodeAt(end-1);if(ch>=0xd800&&ch<=0xdbff)end--;}
    trace('[dialog] '+now+' '+label+' part='+ ++part+' text='+text.slice(at,end)+'\n');
    at=end;
  }
  if(source.length>4096)trace('[dialog] '+now+' '+label+' truncated=true\n');
}
export {debugLogStatus};
