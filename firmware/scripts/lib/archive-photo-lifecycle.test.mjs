import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {test} from 'node:test'
const app=new URL('../../host/app/',import.meta.url)
const release=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('archive-camera-release.js',app))).toString('base64'))
const source=fs.readFileSync(new URL('lan-archive.js',app),'utf8').replace(/^import [\s\S]*? from '[^']+';?\s*$/gm,'').replace(/export /g,'')
async function harness(failure){
 const events=[],records=[],shown=[];let speaker='A',resolveFrame,current=true
 const frame={width:2,height:2,imageType:'rgb565le',buffer:new ArrayBuffer(8),close(){events.push('frame')}}
 const file={write(){events.push('write');if(failure==='sd')throw Error('SD failure')},flush(){events.push('flush')},close(){events.push('file.close')}}
 const root={createDirectory(){},openFile(){return file}}
 class Bytes extends ArrayBuffer{static fromString(s){return new TextEncoder().encode(s).buffer}}
 const robot={camera:{async capture(){events.push('capture');if(failure==='start')throw Error('start failure');if(failure==='late')return new Promise(r=>resolveFrame=r);return frame},stop(){events.push('stop');if(failure==='stop')throw Error('stop failure')},close(){events.push('close')}},showBalloon(text){shown.push(text)}}
 const context=vm.createContext({robot,trace(){},...release,ArrayBuffer:Bytes,
  heapStatus:()=>({internalFree:1,internalLargest:1,psramFree:1}),
  directChatStatus:()=>({speaker:{id:speaker}}),withSDCard:fn=>fn(root),
  recordMemory:record=>records.push(record),
  encodeJPEG(){events.push('jpeg');if(failure==='jpeg')throw Error('jpeg failure');return new ArrayBuffer(4)},
  async analyzeJPEG(){events.push('analysis');return {status:'complete',text:'木です'}}
 })
 vm.runInContext(source,context)
 context.captureContext={speakerId:'A',isCurrent:()=>current}
 return {context,events,records,shown,robot,resolve(){resolveFrame(frame)},changeSpeaker(){speaker='B';current=false}}
}
for(const failure of ['none','start','jpeg','sd','stop'])test('photo lifecycle '+failure,async()=>{
 const h=await harness(failure)
 const run=()=>vm.runInContext('photo(robot,{},true,captureContext)',h.context)
 if(failure==='none')await run();else await assert.rejects(run,new RegExp(failure==='sd'?'SD':failure))
 assert.equal(vm.runInContext('busy',h.context),false)
 assert.ok(h.events.indexOf('stop')>=0);assert.equal(h.events.includes('close'),true,'native close must run even when SD save fails')
 assert.ok(h.events.indexOf('close')>h.events.indexOf('stop'))
 if(failure!=='start')assert.ok(h.events.indexOf('frame')<h.events.indexOf('stop'))
 if(failure==='none'){
  assert.ok(h.events.indexOf('close')<h.events.indexOf('file.close'),'native DMA camera must close before SD I/O')
  assert.ok(h.events.indexOf('analysis')>h.events.indexOf('close'))
  assert.deepEqual(h.records.map(r=>r.speakerId),['A','A'])
 }else assert.equal(h.events.includes('analysis'),false)
})
test('speaker changes during capture cannot reattribute history or display the previous speaker result',async()=>{
 const h=await harness('late')
 const pending=vm.runInContext('photo(robot,{},true,captureContext)',h.context)
 h.changeSpeaker();h.resolve();await pending
 assert.deepEqual(h.records.map(r=>r.speakerId),['A','A'])
 assert.equal(h.shown.length,0)
})
