import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {stripTypeScriptTypes} from 'node:module'

// The production device wrapper is run against a native double.
// Captured frames must be explicitly released before native stop/close.
async function harness(failure){
  const events=[];const optionsSeen=[]
  class Native{
    width=2;height=2;imageType=1
    constructor(options){
      events.push('constructor')
      optionsSeen.push(options)
      assert.equal('onReadable' in options,false,'polling must not install a native JS callback')
    }
    start(){events.push('start')}
    read(){
      const b=new ArrayBuffer(8)
      b.close=()=>{events.push('frame');if(failure==='frame')throw Error('frame failed')}
      return b
    }
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
    let module
    if(values[name])module=new vm.SyntheticModule(Object.keys(values[name]),function(){for(const [k,v]of Object.entries(values[name]))this.setExport(k,v)},{context})
    else{
      const path=name==='camera'?'camera.ts':'capture-options.ts'
      const source=fs.readFileSync(new URL('../../host/modules/camera/device/'+path,import.meta.url),'utf8')
      module=new vm.SourceTextModule(stripTypeScriptTypes(source,{mode:'strip'}),{context})
    }
    cache.set(name,module);await module.link(load);return module
  }
  const module=await load('camera');await module.evaluate()
  return {camera:new module.namespace.default(),events,optionsSeen}
}

for(const failure of ['none','frame','stop','close'])test('device teardown '+failure,async()=>{
  const h=await harness(failure)
  h.camera.start()
  const frame=await h.camera.capture()
  assert.ok(frame?.buffer,'frame returned through read() polling')
  if(failure==='frame')assert.throws(()=>frame.close(),/frame failed/)
  else frame.close()
  if(failure==='stop'||failure==='close')assert.throws(()=>h.camera.close(),new RegExp(failure+' failed'))
  else h.camera.close()
  assert.deepEqual(h.events,['constructor','start','frame','stop','close'])
  h.camera.start()
  assert.deepEqual(h.events.slice(-2),['constructor','start'])
})

test('ten captures return each disposable buffer exactly once with no native callback',async()=>{
  const h=await harness('none')
  for(let i=0;i<10;i++){
    h.camera.start()
    const frame=await h.camera.capture()
    assert.equal(frame.buffer.byteLength,8)
    frame.close();frame.close()
    h.camera.stop();h.camera.close()
  }
  for(const event of ['constructor','frame','stop','close'])
    assert.equal(h.events.filter(e=>e===event).length,10,event)
  assert.equal(h.optionsSeen.length,10)
})
