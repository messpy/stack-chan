import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source=fs.readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
const start=source.indexOf('async function photo(robot,args={},fromConversation=false) {')
const end=source.indexOf('async function describeImage(',start)
assert.ok(start>=0&&end>start,'photo implementation is present')
const implementation=source.slice(start,end)

function harness({initialBusy=false,failStop=false,failCapture=false,failClose=false}={}){
  const events=[]
  const context={
    busy:initialBusy,Date,trace:()=>{},id:()=>String(11),
    encodeJPEG:()=>new Uint8Array([1,2,3]),
    save:()=>events.push('save'),
    describeImage:async()=>({analysis:{status:'complete',text:'画像'}})
  }
  const frame={buffer:new ArrayBuffer(4),width:176,height:144,imageType:'rgb565le',close(){events.push('frame-close');if(failClose)throw Error('close failed')}}
  const robot={camera:{
    async capture(){events.push('capture');if(failCapture)throw Error('capture failed');return frame},
    async stop(){events.push('stop');if(failStop)throw Error('stop failed')}
  }}
  const photo=vm.runInNewContext(implementation+'\nphoto',context)
  return {photo,robot,context,events}
}

test('photo releases camera and busy state after saving',async()=>{
  const h=harness()
  const result=await h.photo(h.robot,{analyze:false})
  assert.equal(result.image,'photo-11.jpg')
  assert.equal(h.context.busy,false)
  assert.deepEqual(h.events,['capture','save','frame-close','stop'])
})

test('camera stop errors cannot permanently lock the busy flag',async()=>{
  const h=harness({failStop:true})
  await assert.rejects(h.photo(h.robot,{analyze:false}),/stop failed/)
  assert.equal(h.context.busy,false)
})

test('frame close errors do not skip camera stop or leak busy state',async()=>{
  const h=harness({failClose:true})
  const result=await h.photo(h.robot,{analyze:false})
  assert.equal(result.width,176)
  assert.deepEqual(h.events,['capture','save','frame-close','stop'])
  assert.equal(h.context.busy,false)
})

test('capture rejection still attempts camera stop and releases busy flag',async()=>{
  const h=harness({failCapture:true})
  await assert.rejects(h.photo(h.robot,{analyze:false}),/capture failed/)
  assert.deepEqual(h.events,['capture','stop'])
  assert.equal(h.context.busy,false)
})

test('camera invoked by chat preserves an already held audio lease state',async()=>{
  const h=harness({initialBusy:true})
  const result=await h.photo(h.robot,{question:'何が見える？'},true)
  assert.equal(result.analysis.status,'complete')
  assert.equal(h.context.busy,true)
})
