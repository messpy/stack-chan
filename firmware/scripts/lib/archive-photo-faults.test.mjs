import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Test the current capture -> JPEG -> native teardown -> SD sequence.
// Camera-release error branches are exercised with the production cleanup helper.
const source=fs.readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
const start=source.indexOf('async function photo(')
const end=source.indexOf('async function describeImage(',start)
assert.ok(start>=0&&end>start,'current photo implementation exists')
const implementation=source.slice(start,end)
const releaseSource=fs.readFileSync(new URL('../../host/app/archive-camera-release.js',import.meta.url),'utf8')
const {releaseCameraResources}=await import('data:text/javascript;base64,'+Buffer.from(releaseSource).toString('base64'))

function fixture(fault='none'){
  const events=[],logs=[]
  const fail=stage=>{events.push(stage);if(fault===stage)throw Error(stage+' failed')}
  const frame={width:176,height:144,imageType:'rgb565le',buffer:new ArrayBuffer(50688),close(){fail('frame-close')}}
  const camera={
    async capture(){fail('capture');return frame},
    stop(){fail('camera-stop')},
    close(){fail('camera-close')},
  }
  const ctx={
    busy:false,
    Date,
    trace:s=>logs.push(String(s)),
    id:()=>String(11),
    directChatStatus:()=>({cameraCaptureActive:false,speaker:null}),
    heapStatus:()=>({internalFree:100000,internalLargest:70000,psramFree:7000000}),
    releaseCameraResources,
    encodeJPEG(){fail('jpeg');return new Uint8Array([1,2,3])},
    save(){fail('save')},
  }
  const photo=vm.runInNewContext(implementation+'\nphoto',ctx)
  return {events,logs,run:()=>photo({camera},{analyze:false}),ctx}
}

test('repeated captures release native camera before any SD operation',async()=>{
  const f=fixture()
  for(let i=0;i<3;i++){
    const result=await f.run()
    assert.equal(result.image,'photo-11.jpg')
    assert.equal(result.width,176)
    assert.equal(f.ctx.busy,false)
  }
  for(const stage of ['capture','jpeg','frame-close','camera-stop','camera-close','save']){
    assert.equal(f.events.filter(x=>x===stage).length,3,stage)
  }
  assert.deepEqual(f.events.slice(0,6),['capture','jpeg','frame-close','camera-stop','camera-close','save'])
})

for(const failure of ['capture','jpeg','frame-close','camera-stop','camera-close','save']){
  test('photo '+failure+' failure releases ownership and preserves error stage',async()=>{
    const f=fixture(failure)
    await assert.rejects(f.run(),new RegExp(failure+' failed'))
    assert.equal(f.ctx.busy,false,'photo busy flag is released')
    assert.equal(f.events.filter(x=>x==='camera-stop').length,1,'camera stop attempted')
    assert.equal(f.events.filter(x=>x==='camera-close').length,1,'camera close attempted')
    assert.equal(f.events.includes('frame-close'),failure!=='capture','frame close attempted when captured')
    if(failure!=='save')assert.ok(!f.events.includes('save'),'never write SD after camera failure')
    if(failure==='save')assert.ok(f.events.indexOf('camera-close')<f.events.indexOf('save'))
    const expectedStage=['frame-close','camera-stop','camera-close'].includes(failure)?'camera-release':failure==='capture'?'camera-start':failure==='jpeg'?'jpeg-encode':'sd-save'
    assert.ok(f.logs.some(s=>s.includes('failed stage='+expectedStage)),expectedStage+' is reported')
  })
}
