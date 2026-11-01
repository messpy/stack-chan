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
        trace('[heap] internalFree='+m.internalFree+' internalMinimum='+m.internalMinimum+' internalLargest='+m.internalLargest+' psramFree='+m.psramFree+' psramMinimum='+m.psramMinimum+' psramLargest='+m.psramLargest+'\n');
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
export {debugLogStatus};
