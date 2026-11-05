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
    chat:{state:'retrying',provider:'xiaozhi',enabled:true,detail:'内蔵RAM不足 token=SECRET'},
    photo:{phase:'error',errorStage:'sd-save',saved:false,image:'PRIVATE_IMAGE'},
    debug:{queued:4,dropped:2,secret:'PRIVATE_LOG'},
    servo:{lastReadFailure:'timeout',reason:'SECRET_NATIVE'},
    resetCode:9,uptime:123456.5,
    now:1793859000000
  })
  assert.equal(actual.heap.internalFree,76659)
  assert.equal(actual.heap.internalLargest,31744)
  assert.equal(actual.chat.failureClass,'memory-pressure')
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
