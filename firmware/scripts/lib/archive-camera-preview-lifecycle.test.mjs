import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source=fs.readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
const start=source.indexOf('async function cameraPreview(robot) {')
const end=source.indexOf('async function photo(',start)
assert.ok(start>=0&&end>start,'cameraPreview implementation is present')
const implementation=source.slice(start,end)

function harness(failCapture=false){
  const events=[]
  const context={
    busy:false,
    pauseDirectChat(){events.push('pause-chat');return true},
    resumeDirectChat(){events.push('resume-chat')},
    encodeJPEG:()=>new Uint8Array([1,2,3])
  }
  const robot={camera:{
    async start(){events.push('start')},
    async capture(){events.push('capture');if(failCapture)throw Error('preview failed');return {buffer:new ArrayBuffer(4),width:176,height:144,imageType:'rgb565le',close(){events.push('frame-close')}}},
    async stop(){events.push('stop')}
  }}
  const cameraPreview=vm.runInNewContext(implementation+'\ncameraPreview',context)
  return {cameraPreview,context,robot,events}
}

test('preview starts camera explicitly and stops before resuming chat',async()=>{
  const h=harness()
  const jpeg=await h.cameraPreview(h.robot)
  assert.equal(jpeg.byteLength,3)
  assert.deepEqual(h.events,['pause-chat','start','capture','frame-close','stop','resume-chat'])
  assert.equal(h.context.busy,false)
})

test('preview capture failure still stops camera and resumes chat',async()=>{
  const h=harness(true)
  await assert.rejects(h.cameraPreview(h.robot),/preview failed/)
  assert.deepEqual(h.events,['pause-chat','start','capture','stop','resume-chat'])
  assert.equal(h.context.busy,false)
})
