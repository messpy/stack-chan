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

test('memory pressure is not displayed as a network disconnect',()=>{
  const direct=readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
  assert.match(direct,/const memoryBlocked = isMemoryPressure\(reason\)/)
  assert.match(direct,/error = memoryBlocked[\s\S]*?内蔵RAMが不足しているため、音声会話を一時停止しています。/)
  assert.match(direct,/Math\.max\(retryDelay,memoryBlocked\?10000:0\)/)
  const policy=readFileSync(new URL('../../host/app/archive-memory-policy.js',import.meta.url),'utf8')
  assert.match(policy,/112 : 80/)
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
