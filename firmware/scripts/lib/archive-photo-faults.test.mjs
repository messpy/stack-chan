import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Execute the production photo function with hardware boundary fault injection.
const code=fs.readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/export /g,'')
function fixture(fault) {
  const events=[]
  const fail=where=>{events.push(where);if(fault===where)throw new Error(where+' failure')}
  const c=vm.createContext({
    trace(){},traceConversation(){},photoRecoveryCheckpoint(){},
    photoRecoveryWatchdog:on=>events.push(on?'arm':'disarm'),
    quarantineCameraHandoff:()=>events.push('quarantine'),
    encodeJPEG(){fail('jpeg');return new ArrayBuffer(4)},
    withSDCard:fn=>fn({createDirectory(){},openFile(){fail('save');return {
      write(){fail('write')},flush(){fail('flush')},close(){events.push('file.close')}
    }}}),
  })
  vm.runInContext(code,c)
  const frame={width:176,height:144,imageType:'rgb565le',buffer:new ArrayBuffer(50688),close(){fail('frame.close')}}
  c.robot={camera:{async captureWithProcessor(options,process){fail('capture');return process(frame)},close(stage){fail('camera.close');stage('CAMERA_NATIVE_CLOSE_DONE')}}}
  return {events,run:()=>vm.runInContext('photo(robot,{analyze:false})',c)}
}
test('DMA frame/camera released exactly once before file I/O, also on repeated captures',async()=>{
  const f=fixture()
  for(let n=0;n<3;n++)assert.equal((await f.run()).width,176)
  assert.equal(f.events.filter(e=>e==='frame.close').length,3)
  assert.equal(f.events.filter(e=>e==='camera.close').length,3)
  assert.ok(f.events.indexOf('jpeg')<f.events.indexOf('frame.close'))
  assert.ok(f.events.indexOf('camera.close')<f.events.indexOf('save'))
  assert.ok(f.events.indexOf('flush')<f.events.indexOf('file.close'))
  assert.equal(f.events.filter(e=>e==='quarantine').length,0)
})
for(const fault of ['capture','jpeg','save','write','flush','frame.close','camera.close']) {
  test('photo safely handles '+fault+' failure',async()=>{
    const f=fixture(fault)
    await assert.rejects(f.run(),new RegExp(fault.replace('.','\\.')))
    assert.equal(f.events.filter(e=>e==='camera.close').length,1)
    assert.equal(f.events.filter(e=>e==='frame.close').length,fault==='capture'?0:1)
    if(fault==='frame.close'||fault==='camera.close') {
      assert.ok(f.events.includes('quarantine'))
      assert.ok(!f.events.includes('disarm'))
      assert.ok(!f.events.includes('save'))
    }else assert.ok(f.events.includes('disarm'))
    if(fault==='write'||fault==='flush')assert.ok(f.events.includes('file.close'))
  })
}
