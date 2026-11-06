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
export {debugLogStatus};

// Bounded, credential-free diagnostics. Do not retain history on RAM-limited CoreS3.
// PC clients can sample the authenticated LAN endpoint and store data locally.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const tag = (value, limit=40) => typeof value === 'string' && /^[a-z0-9-]+$/.test(value) ? value.slice(0,limit) : 'unknown';

export function heapSummary(heap) {
  const h = heap || {};
  return {
    internalFree: count(h.internalFree),
    internalLargest: count(h.internalLargest),
    internalMinimum: count(h.internalMinimum),
    nativeStackMinimumFree: count(h.nativeStackMinimumFree),
    psramFree: count(h.psramFree),
    psramLargest: count(h.psramLargest),
    psramMinimum: count(h.psramMinimum),
  };
}

export function servoReasonCode(reason) {
  const value = String(reason || '').slice(0,160).toLowerCase();
  if (/timeout|timed out|タイムアウト/.test(value)) return 'timeout';
  if (/checksum|crc|invalid|framing|packet|reply|response/.test(value)) return 'invalid-reply';
  if (/uart|serial|bus|parity/.test(value)) return 'bus-error';
  if (/power|voltage|電源/.test(value)) return 'power-error';
  if (/unavailable|missing|not found|not initialized/.test(value)) return 'unavailable';
  return 'unknown';
}

export function memoryReasonCode(detail) {
  const value = String(detail || '').slice(0,220);
  if (/Microphone upload stalled/i.test(value)) return 'audio-upload-stalled';
  if (/Microphone PCM stalled/i.test(value)) return 'audio-input-stalled';
  if (/内蔵RAM|memory|allocat|opus encoder/i.test(value)) return 'memory-pressure';
  if (/\b401\b|\b403\b|unauthori[sz]ed|authentication/i.test(value)) return 'authentication';
  if (/timeout|network|dns|websocket|socket|connect/i.test(value)) return 'network';
  return value ? 'other' : 'none';
}

export function markHeap(stage, heap, emit) {
  const summary = heapSummary(heap);
  if (typeof emit === 'function') {
    // Only numeric counts and a validated static stage; never keys, IPs or dialogue.
    try {
      emit('[diag-heap] stage=' + tag(stage) +
        ' free=' + summary.internalFree +
        ' largest=' + summary.internalLargest +
        ' minimum=' + summary.internalMinimum +
        ' psramFree=' + summary.psramFree + '\n');
    } catch (_) {}
  }
  return summary;
}

export function diagnosticSnapshot({heap, chat, photo, debug, servo, resetCode, uptime, now}) {
  const c = chat || {}, p = photo || {}, d = debug || {};
  return {
    schema: 1,
    boot: {resetReasonCode: count(resetCode), uptimeMs: Number.isFinite(uptime) && uptime >= 0 ? Math.floor(uptime) : null},
    at: Number.isSafeInteger(now) && now > 0 ? now : null,
    heap: heapSummary(heap),
    chat: {
      state: tag(c.state), provider: tag(c.provider),
      enabled: c.enabled === true, recognitionMode: c.recognitionMode === true,
      failureClass: ['retrying', 'failed', 'error'].includes(c.state) ? memoryReasonCode(c.detail) : 'none',
      memoryRecovery:{failures:count(c.memoryRecovery?.failures),stopped:c.memoryRecovery?.stopped===true,limit:count(c.memoryRecovery?.limit)},
      // A prior preflight is intentionally retained across reconnects; this is not live heap.
      lastMemoryAdmission:c.memoryAdmission ? {
        status:['pass','blocked','unmeasured'].includes(c.memoryAdmission.status)?c.memoryAdmission.status:'unknown',
        mode:['conversation','transcription','recognition-transport'].includes(c.memoryAdmission.mode)?c.memoryAdmission.mode:'unknown',
        at:count(c.memoryAdmission.at),
        internalFree:count(c.memoryAdmission.internalFree),
        internalLargest:count(c.memoryAdmission.internalLargest),
        requiredFree:count(c.memoryAdmission.requiredFree),
        requiredLargest:count(c.memoryAdmission.requiredLargest),
        shortfallFree:count(c.memoryAdmission.shortfallFree),
        shortfallLargest:count(c.memoryAdmission.shortfallLargest),
      } : null,
    },
    audio: {
      phase: tag(c.audioPhase), provider: tag(c.pipeline?.provider), input: tag(c.pipeline?.input), output: tag(c.pipeline?.output),
      worker: tag(c.pipeline?.worker), uploadEnabled: c.pipeline?.uploadEnabled === true,
      lastInputAt: count(c.pipeline?.lastInputAt), lastSentAt: count(c.pipeline?.lastSentAt),
      lastASRAt: count(c.audio?.lastTranscriptAt), overrunBytes: count(c.pipeline?.overrunBytes), overruns: count(c.pipeline?.overruns),
      sampleRate: count(c.playback?.sampleRate), underruns: count(c.playback?.underruns),
      bufferedMs: count(c.playback?.bufferedMs), queuedMs: count(c.playback?.queuedMs),
      playbackActive: c.playback?.active === true, reconnectCount: count(c.reconnectCount),
      lastError: tag(c.pipeline?.lastError),
    },
    photo: {
      phase: tag(p.phase), saved: p.saved === true,
      errorStage: p.errorStage == null ? null : tag(p.errorStage),
      active: p.active === true,
    },
    servo: {lastReadFailure: tag(servo?.lastReadFailure || 'none')},
    debug: {
      queued: count(d.queued), dropped: count(d.dropped),
      truncated: count(d.truncated), usbRetries: count(d.usbRetries),
    },
  };
}
