import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {stripTypeScriptTypes} from 'node:module'

// Execute the actual device wrapper with a native double: no hardware access.
async function harness(failure){
 const events=[];let options
 class Native{
  width=2;height=2;imageType=1
  constructor(o){events.push('constructor');options=o}
  start(){events.push('start')}
  read(){const b=new ArrayBuffer(8);b.close=()=>{events.push('frame');if(failure==='frame')throw Error('frame failed')};return b}
  stop(){events.push('stop');if(failure==='stop')throw Error('stop failed')}
  close(){events.push('close');if(failure==='close')throw Error('close failed')}
 }
 const context=vm.createContext({trace(){}}),cache=new Map()
 const values={
  'embedded:io/image/in/camera':{default:Native},
  'commodetto/Bitmap':{default:{RGB565LE:1,RGB565BE:2,JPEG:3}},
  'camera-initial-frame':{waitForInitialCameraFrame:async()=>undefined},
 }
 async function load(name){
  if(cache.has(name))return cache.get(name)
  let mod
  if(values[name])mod=new vm.SyntheticModule(Object.keys(values[name]),function(){for(const[k,v]of Object.entries(values[name]))this.setExport(k,v)},{context})
  else{
   const path=name==='camera'?'camera.ts':'capture-options.ts'
   const source=fs.readFileSync(new URL('../../host/modules/camera/device/'+path,import.meta.url),'utf8')
   mod=new vm.SourceTextModule(stripTypeScriptTypes(source,{mode:'strip'}),{context})
  }
  cache.set(name,mod);await mod.link(load);return mod
 }
 const mod=await load('camera');await mod.evaluate()
 return {camera:new mod.namespace.default(),events,readable:()=>options.onReadable()}
}
for(const failure of ['none','frame','stop','close'])test('device teardown '+failure,async()=>{
 const h=await harness(failure)
 h.camera.start();h.readable()
 if(failure==='none')h.camera.close()
 else assert.throws(()=>h.camera.close(),new RegExp(failure+' failed'))
 assert.deepEqual(h.events,['constructor','start','frame','stop','close'])
 h.camera.start()
 assert.deepEqual(h.events.slice(-2),['constructor','start'])
})

test('ten captures return each client buffer once and create a new native instance after close',async()=>{
 const h=await harness('none')
 for(let i=0;i<10;i++){
  h.camera.start();h.readable()
  const frame=await h.camera.capture()
  assert.equal(frame.buffer.byteLength,8)
  frame.close();frame.close()
  h.camera.stop();h.camera.close()
 }
 for(const event of ['constructor','frame','stop','close'])assert.equal(h.events.filter(e=>e===event).length,10,event)
})
