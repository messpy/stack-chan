import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source=fs.readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
const start=source.indexOf('async function photo(')
const end=source.indexOf('async function describeImage(',start)
assert.ok(start>=0&&end>start,'photo implementation exists')
const code=source.slice(start,end)
const helper=fs.readFileSync(new URL('../../host/app/archive-camera-release.js',import.meta.url),'utf8')
const {releaseCameraResources}=await import('data:text/javascript;base64,'+Buffer.from(helper).toString('base64'))

function harness({initialBusy=false,cameraCaptureActive=false,failure}={}){
  const events=[]
  const frame={
    buffer:new ArrayBuffer(8),width:176,height:144,imageType:'rgb565le',
    close(){events.push('frame-close');if(failure==='frame')throw Error('frame failed')},
  }
  const robot={camera:{
    async capture(){events.push('capture');if(failure==='capture')throw Error('capture failed');return frame},
    stop(){events.push('stop');if(failure==='stop')throw Error('stop failed')},
    close(){events.push('close')},
  }}
  const context={
    busy:initialBusy,Date,
    trace(){},id:()=>String(11),
    heapStatus:()=>({internalFree:100000,internalLargest:70000,psramFree:7000000}),
    directChatStatus:()=>({speaker:{id:'person'},cameraCaptureActive}),
    releaseCameraResources,
    encodeJPEG(){events.push('jpeg');return new Uint8Array([1,2,3])},
    save(){events.push('save')},
    async describeImage(){events.push('analysis');return {analysis:{status:'complete',text:'画像'}}},
  }
  const photo=vm.runInNewContext(code+'\nphoto',context)
  return {photo,robot,context,events}
}

test('successful photo releases native camera before SD write and clears busy',async()=>{
  const h=harness()
  const result=await h.photo(h.robot,{analyze:false})
  assert.equal(result.image,'photo-11.jpg')
  assert.equal(h.context.busy,false)
  assert.deepEqual(h.events,['capture','jpeg','frame-close','stop','close','save'])
})

for(const failure of ['stop','frame','capture']){
  test('failed '+failure+' always releases photo busy state',async()=>{
    const h=harness({failure})
    await assert.rejects(h.photo(h.robot,{analyze:false}),new RegExp(failure+' failed'))
    assert.equal(h.context.busy,false)
    assert.equal(h.events.filter(e=>e==='stop').length,1)
    assert.equal(h.events.filter(e=>e==='close').length,1)
    assert.equal(h.events.includes('save'),false)
  })
}

test('conversation photo accepts an already-held pause gate without double ownership',async()=>{
  const h=harness({cameraCaptureActive:true})
  const result=await h.photo(h.robot,{question:'何が見える？'},true,{speakerId:'person',isCurrent:()=>true})
  assert.equal(result.analysis.status,'complete')
  assert.equal(h.context.busy,false)
  assert.equal(h.events.at(-1),'analysis')
})

test('USB photo cannot steal camera while voice handoff is active',async()=>{
  const h=harness({cameraCaptureActive:true})
  await assert.rejects(h.photo(h.robot,{analyze:false},false),/Camera busy/)
  assert.equal(h.events.length,0)
  assert.equal(h.context.busy,false)
})

test('concurrent capture cannot bypass an existing busy lock',async()=>{
  const h=harness({initialBusy:true})
  await assert.rejects(h.photo(h.robot,{analyze:false},true),/Camera busy/)
  assert.equal(h.events.length,0)
  assert.equal(h.context.busy,true)
})
