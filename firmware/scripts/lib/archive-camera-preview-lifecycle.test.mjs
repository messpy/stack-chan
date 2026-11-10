import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source=fs.readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
const start=source.indexOf('async function cameraPreview(robot) {')
const end=source.indexOf('async function photo(',start)
assert.ok(start>=0&&end>start,'cameraPreview implementation exists')
const implementation=source.slice(start,end)
const releaseSource=fs.readFileSync(new URL('../../host/app/archive-camera-release.js',import.meta.url),'utf8')
const {releaseCameraResources}=await import('data:text/javascript;base64,'+Buffer.from(releaseSource).toString('base64'))

function harness(fault){
  const events=[]
  const context={
    busy:false,
    directChatStatus:()=>({busy:false,cameraCaptureActive:false}),
    holdDirectChat(reason){events.push('pause:'+reason);return()=>events.push('resume')},
    releaseCameraResources,
    trace(){},
    encodeJPEG(){events.push('jpeg');return new Uint8Array([1,2,3])},
  }
  const camera={
    async capture(){events.push('capture');if(fault==='capture')throw Error('preview failed');return {buffer:new ArrayBuffer(4),width:176,height:144,imageType:'rgb565le',close(){events.push('frame-close');if(fault==='frame')throw Error('frame failed')}}},
    stop(){events.push('stop');if(fault==='stop')throw Error('stop failed')},
    close(){events.push('close');if(fault==='close')throw Error('close failed')},
  }
  const preview=vm.runInNewContext(implementation+'\ncameraPreview',context)
  return {events,context,run:()=>preview({camera})}
}

test('preview holds chat, captures JPEG, releases all resources, then resumes chat',async()=>{
  const h=harness()
  const jpeg=await h.run()
  assert.equal(jpeg.byteLength,3)
  assert.deepEqual(h.events,['pause:camera-preview','capture','jpeg','frame-close','stop','close','resume'])
  assert.equal(h.context.busy,false)
})

for(const fault of ['capture','frame','stop','close']){
  test('preview '+fault+' failure still releases chat lease and attempts native cleanup',async()=>{
    const h=harness(fault)
    await assert.rejects(h.run(),new RegExp(fault==='capture'?'preview failed':fault+' failed'))
    assert.equal(h.events.at(-1),'resume')
    assert.equal(h.events.filter(e=>e==='stop').length,1)
    assert.equal(h.events.filter(e=>e==='close').length,1)
    assert.equal(h.context.busy,false)
  })
}
