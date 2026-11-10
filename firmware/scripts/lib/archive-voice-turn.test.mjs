import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import vm from 'node:vm'

const fullSource=readFileSync(new URL('../../host/app/archive-debug.js',import.meta.url),'utf8')
const source=fullSource.slice(fullSource.indexOf('// Bounded, credential-free diagnostics.'))
const mod=new vm.SourceTextModule(source,{context:vm.createContext({Number,String,RegExp,Error,Date,JSON})})
await mod.link(()=>{throw Error('Diagnostics must have no imports')})
await mod.evaluate()
const {createVoiceTurnTracker,diagnosticSnapshot}=mod.namespace

test('one reply then next ASR is distinguishable from a quiet interval',()=>{
 let at=1000
 const lines=[]
 const tracker=createVoiceTurnTracker({now:()=>at,emit:line=>lines.push(line)})
 const first=tracker.begin()
 at=1200;assert.equal(tracker.mark(first,'connected'),true)
 at=1600;assert.equal(tracker.mark(first,'asr-final'),true)
 at=2400;assert.equal(tracker.mark(first,'reply-text-final'),true)
 let current=tracker.snapshot().current
 assert.equal(current.asrTurns,1)
 assert.equal(current.replyTurns,1)
 assert.equal(current.postReplyAsrAt,0)
 assert.equal(current.lastReplyAt,2400)
 assert.equal(current.lastNativeState,'connected')
 at=3300;tracker.mark(first,'asr-final')
 current=tracker.snapshot().current
 assert.equal(current.asrTurns,2)
 assert.equal(current.postReplyAsrAt,3300)
 assert.ok(lines.every(s=>!s.includes('question')&&!s.includes('answer')))
})

test('connection loss survives reconnect, stale callbacks cannot change a new session',()=>{
 let at=2000
 const tracker=createVoiceTurnTracker({now:()=>at})
 const old=tracker.begin()
 at=2100;tracker.mark(old,'asr-final')
 at=2800;tracker.mark(old,'reply-text-final')
 at=3100;tracker.mark(old,'disconnected','network')
 at=3200;tracker.end()
 let snap=tracker.snapshot()
 assert.equal(snap.current,null)
 assert.equal(snap.previous.disconnectedAt,3100)
 assert.equal(snap.previous.closedAt,3200)
 assert.equal(snap.previous.failureClass,'network')
 at=3400
 const current=tracker.begin()
 assert.notEqual(old,current)
 assert.equal(tracker.mark(old,'asr-final'),false)
 assert.equal(tracker.mark(current,'connected'),true)
 snap=tracker.snapshot()
 assert.equal(snap.current.asrTurns,0)
 assert.equal(snap.previous.replyTurns,1)
 assert.equal(snap.previous.failureClass,'network')
})

test('sanitization drops secrets and free text from authenticated snapshots',()=>{
 let at=5000
 const tracker=createVoiceTurnTracker({now:()=>at})
 const epoch=tracker.begin()
 at=5500;tracker.mark(epoch,'reply-text-final')
 const raw={...tracker.snapshot().current,token:'PRIVATE_KEY',lastNativeState:'CUSTOM_SECRET',failureClass:'SECURITY_SECRET'}
 const status=diagnosticSnapshot({chat:{
   state:'listening',provider:'xiaozhi',voiceTurn:{current:raw,previous:null},
   pipeline:{uploadEnabled:true,lastSentAt:6000,transcript:'PRIVATE_QUESTION',token:'PRIVATE_KEY'}
 }})
 assert.equal(status.chat.turn.current.lastReplyAt,5500)
 assert.equal(status.chat.turn.current.lastNativeState,'unknown')
 assert.equal(status.chat.turn.current.failureClass,'other')
 assert.equal(status.audio.postReplySentAt,6000)
 assert.ok(!JSON.stringify(status).includes('PRIVATE'))
 assert.ok(!JSON.stringify(status).includes('SECURITY'))
 const disabled=diagnosticSnapshot({chat:{voiceTurn:{current:raw},pipeline:{uploadEnabled:false,lastSentAt:6000}}})
 assert.equal(disabled.audio.postReplySentAt,null)
})

test('record storage bounded to current plus previous and rejects invalid events',()=>{
 let at=8000
 const tracker=createVoiceTurnTracker({now:()=>at})
 for(let i=0;i<20;i++){
  const epoch=tracker.begin()
  at++
  assert.equal(tracker.mark(epoch,'arbitrary-private-message','SECRET'),false)
  tracker.mark(epoch,'failed','SECRET')
  tracker.end()
 }
 const snap=tracker.snapshot()
 assert.equal(Object.keys(snap).length,2)
 assert.equal(snap.current,null)
 assert.equal(snap.previous.epoch,20)
 assert.equal(snap.previous.failureClass,'other')
 assert.equal(snap.previous.asrTurns,0)
})

test('voice state hooks are attached to active chat callbacks only',()=>{
 const direct=readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
 assert.match(direct,/const turnEpoch=voiceTurnTracker\.begin\(\)/)
 assert.match(direct,/if \(chat !== instance\) return\s+const nativeEvent=/)
 assert.match(direct,/voiceTurnTracker\.mark\(turnEpoch,'asr-final'\)/)
 assert.match(direct,/voiceTurnTracker\.mark\(turnEpoch,'reply-text-final'\)/)
 assert.match(direct,/voiceTurnTracker\.end\(\)/)
})
