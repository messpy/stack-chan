import fs from 'node:fs'
import assert from 'node:assert/strict'

async function load(relative){
  const source=fs.readFileSync(new URL(relative,import.meta.url),'utf8')
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
}
const {releaseCameraResources}=await load('../../host/app/archive-camera-release.js')
const {createChatPauseGate}=await load('../../host/app/archive-chat-pause-gate.js')

for(const failure of ['none','frame','stop','close']){
 const events=[],reported=[]
 const camera={
  stop(){events.push('stop');if(failure==='stop')throw Error('stop failed')},
  async close(){events.push('close');if(failure==='close')throw Error('close failed')},
 }
 const frame={close(){events.push('frame');if(failure==='frame')throw Error('frame failed')}}
 const result=releaseCameraResources(camera,frame,(stage)=>reported.push(stage))
 if(failure==='none')await result
 else await assert.rejects(result,new RegExp(failure+' failed'))
 assert.deepEqual(events,['frame','stop','close'])
 assert.equal(reported.length,failure==='none'?0:1)
}
{
 const events=[]
 const gate=createChatPauseGate({pause(){events.push('pause')},resume(){events.push('resume')}})
 const releaseA=gate.hold('photo')
 const releaseB=gate.hold('preview')
 assert.equal(gate.count,2)
 releaseA();releaseA()
 assert.equal(gate.active,true)
 assert.deepEqual(events,['pause'])
 releaseB()
 assert.equal(gate.active,false)
 assert.deepEqual(events,['pause','resume'])
}
console.log('PASS: cleanup order, all error branches and nested camera pause leases')
