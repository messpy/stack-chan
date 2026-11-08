import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {test} from 'node:test'
import {createVoiceTurnTracker,memoryReasonCode} from './archive-diagnostic-fixture.mjs'

const root=new URL('../../host/app/',import.meta.url)
const policy=await import('data:text/javascript;base64,'+Buffer.from(readFileSync(new URL('archive-memory-policy.js',root))).toString('base64'))
const source=readFileSync(new URL('archive-direct-chat.js',root),'utf8').replace(/^import [\s\S]*? from '[^']+';?\s*$/gm,'').replace(/export /g,'')
function harness(transcription=false){
 const timers=[],events=[]
 const settings={chatMode:!transcription,transcriptionMode:transcription,chatProvider:'xiaozhi',directChat:{cloudConsent:true,deviceId:'test',endpoint:'wss://example.test',provisionedAt:Date.now()}}
 const context=vm.createContext({...policy,createVoiceTurnTracker,memoryReasonCode,
  DEFAULT_GEMINI_TEXT_MODEL:'test-text',DEFAULT_GEMINI_MODEL:'test-audio',ollamaModel:()=>'',
  ChatState:{CONNECTED:4,FAILED:0,DISCONNECTED:1,SPEAKING:5,LISTENING:6,WAITING:7},
  ChatService:class{constructor(options){this.callbacks=options.callbacks}start(){}setVolume(){}close(){}},
  createXiaozhiV1Connection:options=>options,XiaoZhiRecognitionIO:class{},ArchiveChatAudioIO:class{},
  listDeviceTools:()=>[],memoryTools:[],visionTools:[],
  VoiceRegistration:class{reset(){}},
  getSettings:()=>settings,changeSettings:fn=>fn(settings),getSettingsStatus:()=>({connected:true}),
  Timer:{set:fn=>{timers.push(fn);return timers.length},clear(){}},
  trace:s=>events.push(s),markHeap(){},collectMemory(){},heapStatus:()=>({internalFree:76659,internalLargest:31744}),
  setXiaoZhiVision(){},beginConversation(){},currentSpeaker:()=>null,
  robotStub:{face:{setMouthOpen(){}},ui:{distribute(){}},drawer:{setDrawerButtonState(){}},audio:{volume:.1,acquireExclusive:()=>()=>{}}},
 })
 vm.runInContext(source,context)
 vm.runInContext('robot=robotStub;claim=()=>true;release=()=>{}',context)
 return {context,events,run:code=>vm.runInContext(code,context),flush:()=>{while(timers.length)timers.shift()()}}
}
for(const transcription of [false,true])test(`persistent low RAM stops bounded retries (${transcription?'transcription':'conversation'})`,async()=>{
 const h=harness(transcription)
 for(let n=1;n<=3;n++){
  await h.run('connect()');h.flush()
  assert.equal(h.run('memoryFailures'),n)
  assert.equal(h.run('state'),n<3?'retrying':'failed')
  assert.equal(h.run('chat'),undefined)
  assert.equal(h.run('connecting'),false)
  assert.equal(h.run('owned'),false)
 }
 assert.match(h.run('error'),/OFF→ON/)
 const attempts=h.run('connectionAttempts'),logs=h.events.length
 // Periodic polling, monitor return, and Wi-Fi recovery cannot bypass the latch.
 for(let n=0;n<20;n++){h.run('resumeDirectChat()');await h.run('connect()')}
 assert.equal(h.run('connectionAttempts'),attempts)
 assert.equal(h.events.length,logs)
 assert.equal(h.run('micLit'),false)
 h.run('suspendDirectChatForAutomaticOffline();resumeDirectChatFromAutomaticOffline()')
 assert.equal(h.run('state'),'failed')
 await h.run('connect()')
 assert.equal(h.run('connectionAttempts'),attempts)
 h.run(transcription?'setRecognitionMode(false);setRecognitionMode(true)':'setChatMode(false);setChatMode(true)')
 assert.equal(h.run('memoryRetryStopped'),false)
 assert.equal(h.run('memoryFailures'),0)
 await h.run('connect()');h.flush()
 assert.equal(h.run('memoryFailures'),1)
 assert.equal(h.run('state'),'retrying')
})
test('transport failures retain existing retries and do not trigger a RAM stop',()=>{
 const h=harness()
 for(let n=0;n<8;n++){
  h.run("state='connecting';failed('network error')");h.flush()
  assert.equal(h.run('memoryRetryStopped'),false)
  assert.equal(h.run('state'),'retrying')
 }
})
test('codec allocation failure releases session ownership and stops after bounded attempts',()=>{
 const h=harness()
 for(let n=0;n<3;n++){
  h.run("state='connecting';owned=true;chat={close(){}};failed('ESP Opus encoder initialization failed')");h.flush()
  assert.equal(h.run('owned'),false)
  assert.equal(h.run('chat'),undefined)
 }
 assert.equal(h.run('state'),'failed')
 assert.equal(h.run('forceProvision'),false)
 // Late duplicate failures cannot restart retries or inflate counters.
 h.run("failed('network error')")
 assert.equal(h.run('memoryFailures'),3)
 assert.equal(h.run('state'),'failed')
})

test('a recovered heap reconnects and successful recognition clears the failure budget',async()=>{
 const h=harness(true)
 await h.run('connect()');h.flush()
 assert.equal(h.run('memoryFailures'),1)
 h.run('heapStatus=()=>({internalFree:160*1024,internalLargest:40*1024})')
 await h.run('connect()')
 assert.equal(h.run('chat!==undefined'),true,h.run('detail'))
 h.run('chat.callbacks.onStateChanged(ChatState.CONNECTED)')
 assert.equal(h.run('state'),'listening')
 assert.equal(h.run('memoryFailures'),0)
 assert.equal(h.run('memoryRetryStopped'),false)
 assert.equal(h.run('detail'),'')
})

test('automatic offline suspension prevents a fresh connection attempt',async()=>{
 const h=harness()
 h.run('suspendDirectChatForAutomaticOffline()')
 await h.run('connect()')
 assert.equal(h.run('connectionAttempts'),0)
 h.run('resumeDirectChatFromAutomaticOffline()')
 await h.run('connect()');h.flush()
 assert.equal(h.run('connectionAttempts'),1)
})
