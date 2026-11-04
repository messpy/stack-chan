import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source=readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
const a=source.indexOf('async function restoreConversationOnBoot(onBoot) {')
const b=source.indexOf('export function startDirectChat(',a)
assert.ok(a>=0&&b>a,'boot restoration is present')
const code=source.slice(a,b)

function mock(settings,opts={}) {
  const events=[]
  const context={
    getSettings:()=>{
      events.push('read')
      if(opts.failRead)throw Error('SD I/O failed')
      return settings
    },
    getSettingsStatus:()=>({generation:opts.generation??7,loadError:opts.loadError??false}),
    setChatMode:on=>{events.push('chat:'+on);return {enabled:on}},
    setRecognitionMode:on=>{events.push('transcription:'+on);return {recognitionMode:on}},
    showConversationBalloon:message=>events.push('warning:'+message),
    trace:message=>events.push('trace:'+message.trim()),
    error:'',detail:'',state:'waiting',
    chatSaveFailedOff:false,recognitionSaveFailedOff:false,
  }
  return {restore:vm.runInNewContext(code+'\nrestoreConversationOnBoot',context),events,context}
}

test('persisted chat ON restores without writing preference or starting transcription',async()=>{
  const h=mock({chatMode:true,transcriptionMode:false})
  await h.restore()
  assert.ok(h.events.includes('chat:true'))
  assert.ok(!h.events.some(v=>v.startsWith('transcription:')))
  assert.ok(h.events.some(v=>v.includes('generation=7')))
})

test('persisted transcription ON restores without starting chat',async()=>{
  const h=mock({chatMode:false,transcriptionMode:true})
  await h.restore()
  assert.ok(h.events.includes('transcription:true'))
  assert.ok(!h.events.includes('chat:true'))
})

test('explicit OFF remains OFF and never starts cloud processing',async()=>{
  const h=mock({chatMode:false,transcriptionMode:false})
  await h.restore()
  assert.ok(!h.events.some(v=>/^chat:|^transcription:/.test(v)))
  assert.ok(h.events.some(v=>v.includes('explicit OFF')))
})

test('boot speech completes before restoring persisted mode',async()=>{
  const h=mock({chatMode:true,transcriptionMode:false})
  let complete
  const speech=new Promise(resolve=>{complete=resolve})
  const pending=h.restore(async()=>{h.events.push('speech started');await speech;h.events.push('speech done')})
  await Promise.resolve()
  assert.equal(h.events.some(v=>v==='read'),false)
  complete()
  await pending
  assert.ok(h.events.indexOf('speech done')<h.events.indexOf('read'))
})

test('unreadable encrypted snapshots warn, keep the originals and do not activate cloud',async()=>{
  const h=mock({chatMode:false,transcriptionMode:false},{loadError:true})
  await h.restore()
  assert.equal(h.context.state,'unconfigured')
  assert.ok(h.context.error.includes('読み取れません'))
  assert.ok(h.events.some(v=>v.startsWith('warning:')))
  assert.ok(!h.events.some(v=>/^chat:|^transcription:/.test(v)))
})

test('contradictory saved chat and transcription do not silently pick either',async()=>{
  const h=mock({chatMode:true,transcriptionMode:true})
  await h.restore()
  assert.equal(h.context.chatSaveFailedOff,true)
  assert.equal(h.context.recognitionSaveFailedOff,true)
  assert.ok(!h.events.some(v=>/^chat:|^transcription:/.test(v)))
  assert.ok(h.events.some(v=>v.startsWith('warning:')))
})

test('failed SD read is visible instead of silently assuming OFF',async()=>{
  const h=mock({}, {failRead:true})
  await h.restore()
  assert.ok(h.context.error.includes('失敗'))
  assert.ok(h.events.some(v=>v.startsWith('warning:')))
})

test('a failure during boot speech still permits stored mode restore',async()=>{
  const h=mock({chatMode:false,transcriptionMode:true})
  await h.restore(async()=>{throw Error('speaker busy')})
  assert.ok(h.events.includes('transcription:true'))
  assert.ok(h.events.some(v=>v.includes('boot] speech failed')))
})

const commandStart=source.indexOf('function modeCommandFromText(text)')
const commandEnd=source.indexOf('let refreshAITalk',commandStart)
assert.ok(commandStart>=0&&commandEnd>commandStart)
const modeCommand=vm.runInNewContext(source.slice(commandStart,commandEnd)+'\nmodeCommandFromText')

test('direct voice commands require explicit ON/OFF or transcription request',()=>{
  const stringify=v=>JSON.stringify(v)
  assert.equal(stringify(modeCommand('AIモードをオフにして')),stringify({kind:'chat',on:false}))
  assert.equal(stringify(modeCommand('会話モードをオンにして')),stringify({kind:'chat',on:true}))
  assert.equal(stringify(modeCommand('文字起こしモードをオンにして')),stringify({kind:'recognition',on:true}))
  assert.equal(stringify(modeCommand('文字起こしをオフにして')),stringify({kind:'recognition',on:false}))
  for(const utterance of ['AIモードをオフにしないで','AIモードの説明','会話について教えて','文字起こしはオフですか？','AIモードがオフ','カメラ撮って'])
    assert.equal(modeCommand(utterance),null,utterance)
})

test('standalone transcription does not expose device tools or cloud function callback',()=>{
  assert.match(source,/tools: recognitionOnly\?\{\}:sessionTools/)
  assert.match(source,/if \(chat !== instance \|\| enrollment\.active \|\| standalone\) return/)
  assert.match(source,/if\(standalone\)\{closeChat\(\);state=recognitionMode\(\)\?'waiting':'off'/)
})
