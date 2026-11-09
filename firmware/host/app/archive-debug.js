import {STARTUP_COMPONENTS} from 'context-startup';
import {heapStatus,initDebugLog,pushDebugLog,popDebugLog,debugLogStatus,usbConnected,writeDebugUSB,startupCheckpoint,startupCheckpointStatus} from 'archive-usb';
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
export {debugLogStatus};

const startupPhases=['initialization','launch','network','context','behavior','ready','unknown'];
const startupErrors=['none','Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','unknown'];
let startupState,startupTimer,startupTicks=0;
export function recordStartupCheckpoint(phase,error,component='none',componentState='begin'){
  try{
    const index=startupPhases.indexOf(phase),stage=index<0?6:index;
    const failed=componentState==='failed'||error!==undefined;
    let kind=!failed?'none':startupErrors.includes(error?.name)?error.name:'unknown';
    let reason='none',site='';
    if(failed){
      const message=String(error?.message||'').toLowerCase();
      reason=/memory|alloc|heap/.test(message)?'memory':/sd|file|mount|storage/.test(message)?'storage':/wifi|network|socket|dns/.test(message)?'network':'unclassified';
      // XS frames use module IDs (often extensionless): ' at fn (module:line)'.
      // Never inspect the exception header: it can contain credentials or user input.
      for(const frame of String(error?.stack||'').split('\n').slice(1)){
        const match=frame.match(/^\s*at\s+(?:[^()]*\()?((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-]+(?:\.(?:js|ts))?(?::[0-9]+(?::[0-9]+)?)?)\)?\s*$/);
        if(match){site=match[1].split('/').pop();break;}
      }
    }
    const componentIndex=STARTUP_COMPONENTS.indexOf(component);
    component=componentIndex<0?'none':component;
    componentState=['begin','done','failed'].includes(componentState)?componentState:'begin';
    startupCheckpoint(stage,startupErrors.indexOf(kind),Math.max(0,componentIndex));
    const memory=heapStatus();
    startupState={phase:startupPhases[stage],error:kind,reason,site,component,componentState,internalFree:memory.internalFree,internalLargest:memory.internalLargest,psramFree:memory.psramFree};
    startupTicks=0;
    sendStartupCheckpoint();
    if(startupTimer===undefined)startupTimer=Timer.repeat(()=>{
      if(++startupTicks>300){Timer.clear(startupTimer);startupTimer=undefined;return;}
      sendStartupCheckpoint();
    },1000);
  }catch(_){/* Diagnostics must never replace the original startup result. */}
}
function sendStartupCheckpoint(){
  try{
    if(!startupState||!usbConnected())return;
    writeDebugUSB(JSON.stringify({event:'startup',...startupCheckpointStatus(),...startupState}));
  }catch(_){}
}

export function startupDiagnosticSnapshot(){return startupState?{...startupState}:undefined;}
