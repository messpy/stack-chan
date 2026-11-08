import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../../host/app/archive-usb-rpc.js',import.meta.url),'utf8')
const {createUSBRpcPump}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const policyText=readFileSync(new URL('../../host/app/archive-memory-policy.js',import.meta.url),'utf8')
const {checkCameraMemory,waitForCameraMemory}=await import('data:text/javascript;base64,'+Buffer.from(policyText).toString('base64'))

const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve()}
function fixture(execute,options={}) {
  let time=0,failNextWrite=false
  const inbox=[],outbox=[],traces=[]
  const pump=createUSBRpcPump({
    read:()=>inbox.shift(),
    write:s=>{if(failNextWrite){failNextWrite=false;throw new Error('USB disconnected')}outbox.push(JSON.parse(s))},
    execute, authenticate:req=>req.token==='test-secret',
    inspect:(op,active)=>({op,busy:true,usbOperation:{...active,phase:'JPEG_START'}}),
    arm:()=>{},now:()=>time,
    trace:s=>traces.push(s),timeoutMs:options.timeoutMs||25000
  })
  return {
    pump,inbox,outbox,traces,
    push:(id,op,token='test-secret')=>inbox.push(JSON.stringify({id,token,op,args:{}})),
    advance:ms=>{time+=ms},
    failWrite:()=>{failNextWrite=true}
  }
}
test('read-only /status is served while photo promise is still pending',async()=>{
  let resolvePhoto
  const f=fixture(req=>req.op==='/photo'?new Promise(resolve=>{resolvePhoto=resolve}):{ok:true})
  f.push(1,'/photo')
  f.pump.tick()
  assert.equal(f.pump.snapshot().active,true)
  f.push(2,'/status')
  f.pump.tick()
  assert.equal(f.outbox.length,1)
  assert.equal(f.outbox[0].result.usbOperation.operation,'/photo')
  assert.equal(f.outbox[0].result.usbOperation.phase,'JPEG_START')
  f.push(3,'/photo')
  f.pump.tick()
  assert.match(f.outbox[1].error,/busy/)
  resolvePhoto({saved:true})
  await settle()
  assert.equal(f.outbox[2].id,1)
  assert.equal(f.outbox[2].result.saved,true)
  assert.equal(f.pump.snapshot().active,false)
})
test('idle debug status reports USB operation snapshot without running normal command',async()=>{
  let calls=0
  const f=fixture(()=>{calls++;return {unused:true}})
  f.push(1,'/debug/status')
  f.pump.tick()
  assert.equal(calls,0,'diagnostic should never run SD/application command')
  assert.equal(f.outbox.length,1)
  assert.equal(f.outbox[0].result.usbOperation.active,false)
  assert.equal(f.outbox[0].result.usbOperation.phase,'JPEG_START')
  f.push(2,'/debug/status','wrong-secret')
  f.pump.tick()
  assert.equal(f.outbox.length,1,'unauthenticated status must be ignored')
  f.push(3,'/photo')
  f.pump.tick()
  await settle()
  assert.equal(calls,1)
  assert.equal(f.pump.snapshot().active,false)
})
test('overdue photo reports failure but remains locked until completion',async()=>{
  let resolvePhoto
  const f=fixture(()=>new Promise(resolve=>{resolvePhoto=resolve}),{timeoutMs:200})
  f.push(10,'/photo')
  f.pump.tick()
  f.advance(201)
  f.pump.tick()
  assert.equal(f.outbox[0].id,10)
  assert.match(f.outbox[0].error,/timed out/)
  assert.equal(f.pump.snapshot().active,true)
  assert.equal(f.pump.snapshot().timedOut,true)
  f.push(11,'/status')
  f.pump.tick()
  assert.equal(f.outbox[1].result.usbOperation.timedOut,true)
  f.push(12,'/photo')
  f.pump.tick()
  assert.match(f.outbox[2].error,/busy/)
  resolvePhoto({saved:true})
  await settle()
  assert.equal(f.outbox.filter(x=>x.id===10).length,1,'no late duplicate RPC response')
  assert.equal(f.pump.snapshot().active,false)
})
test('synchronous exceptions and asynchronous rejection release lock',async()=>{
  let attempt=0
  const f=fixture(()=>{if(++attempt===1)throw new Error('failed before capture');return Promise.reject(new Error('failed after capture'))})
  f.push(1,'/photo')
  f.pump.tick()
  assert.match(f.outbox[0].error,/failed before/)
  assert.equal(f.pump.snapshot().active,false)
  f.push(2,'/photo')
  f.pump.tick()
  await settle()
  assert.match(f.outbox[1].error,/failed after/)
  assert.equal(f.pump.snapshot().active,false)
})
test('unauthenticated commands are silently ignored, write error does not crash pump',async()=>{
  const f=fixture(()=>({ok:true}))
  f.push(1,'/status','invalid-token')
  f.pump.tick()
  assert.equal(f.outbox.length,0)
  f.failWrite()
  f.push(2,'/status')
  f.pump.tick()
  await settle()
  assert.equal(f.outbox.length,0)
  assert.match(f.traces.join(''),/reply failed/)
  f.push(3,'/status')
  f.pump.tick()
  await settle()
  assert.equal(f.outbox[0].id,3)
})
test('camera SRAM preflight blocks voice-reserved RAM and fragmented memory',()=>{
  assert.throws(()=>checkCameraMemory({internalFree:64999,internalLargest:31744,psramFree:6*1024*1024}),/内蔵RAM/)
  assert.throws(()=>checkCameraMemory({internalFree:150000,internalLargest:8192,psramFree:6*1024*1024}),/内蔵RAM/)
  assert.throws(()=>checkCameraMemory({}),/確認できません/)
  assert.doesNotThrow(()=>checkCameraMemory({internalFree:143000,internalLargest:40960,psramFree:6*1024*1024}))
})
test('bounded camera memory wait retries collection and fails closed if still low',async()=>{
  let time=0,reads=0,collects=0
  const heap=await waitForCameraMemory({
    read:()=>++reads<3?{internalFree:64999,internalLargest:31744,psramFree:6*1024*1024}:{internalFree:143000,internalLargest:40960,psramFree:6*1024*1024},
    collect:()=>collects++,
    delay:async(ms)=>{time+=ms},
    now:()=>time,timeoutMs:500,pollMs:100
  })
  assert.equal(heap.internalFree,143000)
  assert.equal(reads,3)
  assert.equal(collects,3)
  assert.equal(time,200)
  time=0
  await assert.rejects(()=>waitForCameraMemory({
    read:()=>({internalFree:64999,internalLargest:31744,psramFree:6*1024*1024}),
    delay:async ms=>{time+=ms},
    now:()=>time,timeoutMs:200,pollMs:100
  }),/内蔵RAM/)
  assert.equal(time,200)
})
test('archive keeps both camera routes behind memory check and reports per-stage status',()=>{
  const archive=readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
  const direct=readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
  const manifest=readFileSync(new URL('../../host/app/manifest_local.json',import.meta.url),'utf8')
  assert.match(manifest,/"archive-usb-rpc"/)
  assert.match(archive,/createUSBRpcPump\(/)
  assert.match(archive,/inspect:\(op,pending\)/)
  assert.match(archive,/request\.op==='\/photo'[\s\S]*?waitForCameraMemory\(\{/)
  assert.match(direct,/waitForCameraMemory\(\{[\s\S]*?photoHandler\(\{analyze:false\}\)/)
  for(const phase of ['CAMERA_START','CAMERA_CAPTURE','JPEG_START','JPEG_DONE','SD_SAVE_START','CAMERA_SAVE','FRAME_RELEASE','CAMERA_CLOSE','CAMERA_CLOSED'])
    assert.match(archive,new RegExp("markPhotoPhase\\('"+phase+"'\\)"))
})
