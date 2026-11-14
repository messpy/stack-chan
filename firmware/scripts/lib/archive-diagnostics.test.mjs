import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import vm from 'node:vm'

const fullSource=readFileSync(new URL('../../host/app/archive-debug.js',import.meta.url),'utf8')
const source=fullSource.slice(fullSource.indexOf('// Bounded, credential-free diagnostics.'))
const mod=new vm.SourceTextModule(source,{context:vm.createContext({Number,String,RegExp,Error})})
await mod.link(()=>{throw Error('Diagnostics must have no imports')})
await mod.evaluate()
const {heapSummary,servoReasonCode,memoryReasonCode,markHeap,diagnosticSnapshot}=mod.namespace

test('read-only snapshot excludes tokens, identifiers, free-text, and servo polling',()=>{
  const actual=diagnosticSnapshot({
    heap:{internalFree:76659,internalLargest:31744,psramFree:100000,secret:'DO_NOT_COPY'},
    chat:{state:'retrying',provider:'xiaozhi',enabled:true,detail:'内蔵RAM不足 token=SECRET',memoryAdmission:{status:'blocked',mode:'conversation',at:1793859000000,internalFree:76659,internalLargest:31744,requiredFree:114688,requiredLargest:24576,shortfallFree:38029,shortfallLargest:0,token:'PRIVATE_KEY'}},
    photo:{phase:'error',errorStage:'sd-save',saved:false,image:'PRIVATE_IMAGE'},
    debug:{queued:4,dropped:2,secret:'PRIVATE_LOG'},
    servo:{lastReadFailure:'timeout',reason:'SECRET_NATIVE'},
    resetCode:9,uptime:123456.5,
    now:1793859000000
  })
  assert.equal(actual.heap.internalFree,76659)
  assert.equal(actual.heap.internalLargest,31744)
  assert.equal(actual.chat.failureClass,'memory-pressure')
  assert.equal(actual.chat.lastMemoryAdmission.status,'blocked')
  assert.equal(actual.chat.lastMemoryAdmission.mode,'conversation')
  assert.equal(actual.chat.lastMemoryAdmission.shortfallFree,38029)
  assert.equal(actual.chat.lastMemoryAdmission.internalLargest,31744)
  assert.equal(actual.chat.lastMemoryAdmission.at,1793859000000)
  assert.equal(diagnosticSnapshot({chat:{state:'retrying',detail:'内蔵RAMが不足'}}).chat.failureClass,'memory-pressure')
  assert.equal(diagnosticSnapshot({chat:{state:'listening',detail:'websocket timeout'}}).chat.failureClass,'none')
  assert.equal(actual.photo.errorStage,'sd-save')
  assert.equal(actual.debug.dropped,2)
  assert.equal(actual.servo.lastReadFailure,'timeout')
  assert.equal(actual.boot.resetReasonCode,9)
  assert.equal(actual.boot.uptimeMs,123456)
  assert.ok(!JSON.stringify(actual).includes('SECRET'))
  assert.ok(!JSON.stringify(actual).includes('PRIVATE'))
  assert.ok(!JSON.stringify(actual).includes('DO_NOT_COPY'))
  assert.ok(!JSON.stringify(actual).includes('token'))
  assert.ok(!('motor' in actual))
})

test('admission snapshot cannot echo arbitrary session labels or secrets',()=>{
  const snap=diagnosticSnapshot({chat:{state:'waiting',memoryAdmission:{
    status:'token',mode:'secret',at:NaN,internalFree:-5,internalLargest:35000,
    requiredFree:114688,requiredLargest:24576,shortfallFree:0,shortfallLargest:0,
    token:'PRIVATE'
  }}})
  assert.equal(snap.chat.lastMemoryAdmission.status,'unknown')
  assert.equal(snap.chat.lastMemoryAdmission.mode,'unknown')
  assert.equal(snap.chat.lastMemoryAdmission.internalFree,null)
  assert.equal(snap.chat.lastMemoryAdmission.internalLargest,35000)
  assert.ok(!JSON.stringify(snap).includes('PRIVATE'))
  assert.equal(diagnosticSnapshot({chat:{state:'off'}}).chat.lastMemoryAdmission,null)
})

test('servo failures are classified without embedding native error strings',()=>{
  assert.equal(servoReasonCode('read timeout; token SECRET'),'timeout')
  assert.equal(servoReasonCode('invalid checksum: raw bytes'),'invalid-reply')
  assert.equal(servoReasonCode('UART bus failure'),'bus-error')
  assert.equal(servoReasonCode('servo power missing'),'power-error')
  assert.equal(servoReasonCode('unrecognized reason'),'unknown')
})

test('heap mark emits only numeric counters and an approved static stage',()=>{
  const emitted=[]
  markHeap('chat-preflight',{internalFree:70000,internalLargest:31000,secret:'SECRET'},s=>emitted.push(s))
  assert.equal(emitted.length,1)
  assert.match(emitted[0],/stage=chat-preflight free=70000 largest=31000/)
  assert.ok(!emitted[0].includes('SECRET'))
  markHeap('private token=SECRET',{internalFree:-3},s=>emitted.push(s))
  assert.ok(emitted[1].includes('stage=unknown'))
  assert.equal(heapSummary({internalFree:-5}).internalFree,null)
})

test('network and authentication details remain sanitized classes',()=>{
  assert.equal(memoryReasonCode('authentication failed 401: SECRET'),'authentication')
  assert.equal(memoryReasonCode('websocket timeout to example.test'),'network')
  assert.equal(memoryReasonCode('custom error SECRET'),'other')
})

test('successful XiaoZhi and recognition-only connections clear old error details',()=>{
  const direct=readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
  assert.match(direct,/state='listening';microphoneAt=Date\.now\(\);error='';detail='';retryDelay=3000;failures=0/)
  assert.match(direct,/error = ''\s+detail = ''\s+retryDelay = 3000\s+failures = 0/)
})

test('audio pipeline snapshot separates PCM, upload, ASR and playback without raw content',()=>{
 const snap=diagnosticSnapshot({chat:{audioPhase:'thinking',reconnectCount:2,audio:{lastTranscriptAt:1100},pipeline:{provider:'xiaozhi',worker:'running',input:'running',output:'closed',uploadEnabled:false,lastInputAt:1200,lastSentAt:1000,overrunBytes:1920,lastError:'audio',token:'SECRET',transcript:'PRIVATE'},playback:{active:false,sampleRate:24000,underruns:3,bufferedMs:0,queuedMs:0}}});
 assert.equal(snap.audio.uploadEnabled,false);assert.equal(snap.audio.lastASRAt,1100);assert.equal(snap.audio.lastInputAt,1200);assert.equal(snap.audio.sampleRate,24000);assert.equal(snap.audio.underruns,3);assert.equal(snap.audio.reconnectCount,2);assert.equal(snap.audio.overrunBytes,1920);assert.equal(snap.audio.phase,'thinking');assert.equal(snap.audio.playbackActive,false);
 assert.ok(!JSON.stringify(snap).includes('SECRET'));assert.ok(!JSON.stringify(snap).includes('PRIVATE'));
});


test('audio progress failures remain distinct from network and memory pressure',()=>{
 assert.equal(memoryReasonCode('Microphone upload stalled'),'audio-upload-stalled');
 assert.equal(memoryReasonCode('Microphone PCM stalled'),'audio-input-stalled');
 assert.equal(diagnosticSnapshot({chat:{state:'retrying',detail:'Microphone upload stalled'}}).chat.failureClass,'audio-upload-stalled');
});


test('persistent RAM stop is visible without copying arbitrary recovery fields',()=>{
 const snap=diagnosticSnapshot({chat:{state:'failed',detail:'内蔵RAM不足',memoryRecovery:{failures:3,stopped:true,limit:3,token:'SECRET'}}});
 assert.equal(snap.chat.failureClass,'memory-pressure');
 assert.equal(snap.chat.memoryRecovery.stopped,true);
 assert.equal(snap.chat.memoryRecovery.failures,3);
 assert.equal(snap.chat.memoryRecovery.limit,3);
 assert.ok(!JSON.stringify(snap).includes('SECRET'));
});

test('bounded health history records states, heartbeat, UI and RAM without private data',()=>{
 let now=0,state='listening',samples=0;
 const lines=[];
 const log=mod.namespace.createHealthLogger({now:()=>now,emit:s=>lines.push(s),sample:()=>{
  samples++;
  return {heap:{internalFree:45000,psramFree:6000000},chat:{state,provider:'xiaozhi',detail:'PRIVATE',pipeline:{input:'running',uploadEnabled:true,token:'SECRET'}},
   ui:{available:true,visible:true,mode:'face',actionsVisible:false,batteryVisible:true,wifiVisible:true,title:'SECRET'},network:{connected:true,ssid:'SECRET'},now:12345,uptime:100};
 }});
 assert.equal(log(),true);
 for(let i=0;i<100;i++)log();
 assert.equal(samples,1);
 now=10000;assert.equal(log(),false);
 now=30000;assert.equal(log(),true);
 state='retrying';now=40000;assert.equal(log(),true);
 assert.equal(lines.length,3);
 for(const line of lines){
  assert.ok(line.length<=2000);
  assert.ok(!/PRIVATE|SECRET/.test(line));
  const value=JSON.parse(line.slice('[health] '.length));
  assert.equal(value.heap.internalFree,45000);
  assert.equal(value.ui.batteryVisible,true);
  assert.equal(value.ui.actionsVisible,false);
 }
})

test('health sampling failure does not escape or flood retry logs',()=>{
 let now=0,calls=0;
 const log=mod.namespace.createHealthLogger({now:()=>now,sample:()=>{calls++;throw Error('SECRET')},emit:()=>assert.fail('no raw error logging')});
 assert.equal(log(),false);assert.equal(log(),false);assert.equal(calls,1);
 now=10000;assert.equal(log(),false);assert.equal(calls,2);
})

test('health JSON remains complete within native slots at maximum diagnostic values',()=>{
 const n=Number.MAX_SAFE_INTEGER,tag='x'.repeat(40),lines=[];
 const sample={heap:Object.fromEntries(['internalFree','internalLargest','internalMinimum','psramFree','psramLargest','psramMinimum','nativeStackMinimumFree'].map(k=>[k,n])),
  chat:{state:tag,provider:tag,detail:'memory',audioPhase:tag,reconnectCount:n,
   pipeline:{provider:tag,input:tag,output:tag,worker:tag,lastError:tag,lastInputAt:n,lastSentAt:n,overruns:n,overrunBytes:n},
   memoryRecovery:{failures:n,limit:n,stopped:true},
   memoryAdmission:{status:'blocked',mode:'recognition-transport',at:n,internalFree:n,internalLargest:n,requiredFree:n,requiredLargest:n,shortfallFree:n,shortfallLargest:n},
   playback:{sampleRate:n,underruns:n,bufferedMs:n,queuedMs:n},audio:{lastTranscriptAt:n}},
  debug:{queued:n,dropped:n,truncated:n,usbRetries:n},photo:{phase:tag,errorStage:tag},servo:{lastReadFailure:tag},uptime:n,now:n};
 assert.equal(mod.namespace.createHealthLogger({sample:()=>sample,emit:line=>lines.push(line)})(),true);
 assert.ok(lines.length>=1&&lines.length<=2);
 for(const line of lines){assert.ok(Buffer.byteLength(line)<2048);assert.doesNotThrow(()=>JSON.parse(line.slice(line.indexOf(' ')+1)));}
})


test('idle diagnostics retain only stage and counters',()=>{
 const value=diagnosticSnapshot({idle:{stage:'drowsy',displayed:'drowsy',idleMs:600000,resetCount:2,lastActivityReason:'SECRET'}});
 assert.equal(value.idle.stage,'drowsy');assert.equal(value.idle.idleMs,600000);assert.ok(!JSON.stringify(value).includes('SECRET'));
});
