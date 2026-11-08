import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import {createVoiceTurnTracker} from './archive-diagnostic-fixture.mjs'

const direct = readFileSync(new URL('../../host/app/archive-direct-chat.js', import.meta.url), 'utf8')
const lan = readFileSync(new URL('../../host/app/lan-archive.js', import.meta.url), 'utf8')
const volume = readFileSync(new URL('../../host/app/archive-volume.js', import.meta.url), 'utf8')

const intentions = direct.slice(
  direct.indexOf('function explicitVisualRequest(text)'),
  direct.indexOf('let refreshAITalk', direct.indexOf('function explicitVisualRequest(text)')),
)
const cameraIntent = vm.runInNewContext(intentions + '\n({explicitVisualRequest,directPhotoRequest})')

test('explicit photo commands are recognized, negated and casual mentions are rejected', () => {
  assert.equal(cameraIntent.explicitVisualRequest('写真撮って'), true)
  assert.equal(cameraIntent.directPhotoRequest('写真を撮ってください'), true)
  for (const message of ['写真を撮らないで', 'カメラで見ないで', '写真について教えて', 'こんにちは', '撮影するな']) {
    assert.equal(cameraIntent.explicitVisualRequest(message), false, message)
    assert.equal(cameraIntent.directPhotoRequest(message), false, message)
  }
  assert.equal(cameraIntent.explicitVisualRequest('この写真を見て'), true)
  assert.equal(cameraIntent.directPhotoRequest('この写真を見て'), false)
})

const photoSource = lan.slice(lan.indexOf('async function photo('), lan.indexOf('async function describeImage(', lan.indexOf('async function photo(')))
assert.ok(photoSource.startsWith('async function photo('), 'photo implementation exists')

function photoHarness(options = {}) {
  const events = []
  const context = {
    busy: options.busy ?? false,
    photoActive: false,
    photoDiagnostics: {phase:'idle',saved:false},
    Date, trace: () => undefined, id: () => '42',
    encodeJPEG: () => new Uint8Array([1, 2, 3]),
    save: () => events.push('save'),
    describeImage: async () => ({ analysis: { status: 'complete', text: '確認' } }),
  }
  context.photoStage=(phase,details={})=>{
    context.photoDiagnostics={...context.photoDiagnostics,phase,...details}
  }
  let resume
  const held = new Promise(resolve => { resume = resolve })
  const robot = { camera: {
    async start() { events.push('start'); if (options.failStart) throw Error('start failed') },
    async capture() {
      events.push('capture')
      if (options.releaseBusy) context.busy = false
      if (options.held) await held
      if (options.failCapture) throw Error('capture failed')
      return { buffer: new ArrayBuffer(4), width: 176, height: 144, imageType: 'rgb565le', close: () => events.push('close') }
    },
    async stop() { events.push('stop'); if (options.failStop) throw Error('stop failed') },
  }}
  return { context, robot, events, resume, photo: vm.runInNewContext(photoSource + '\nphoto', context) }
}

test('photo starts, captures and stops before releasing busy', async () => {
  const h = photoHarness()
  const result = await h.photo(h.robot, { analyze: false })
  assert.equal(result.name, 'photo-42.jpg')
  assert.deepEqual(h.events, ['start', 'capture', 'save', 'close', 'stop'])
  assert.equal(h.context.photoActive, false)
  assert.equal(h.context.busy, false)
  assert.equal(h.context.photoDiagnostics.phase,'complete')
  assert.equal(h.context.photoDiagnostics.saved,true)
  assert.equal(h.context.photoDiagnostics.jpegBytes,3)
})

test('photo concurrent requests are rejected and the first releases lock', async () => {
  const h = photoHarness({ held: true })
  const first = h.photo(h.robot, { analyze: false })
  await assert.rejects(h.photo(h.robot, { analyze: false }), /Camera busy/)
  h.resume()
  await first
  assert.equal(h.context.photoActive, false)
})

test('a conversation that ends during capture does not restore obsolete busy=true', async () => {
  const h = photoHarness({ busy: true, releaseBusy: true })
  await h.photo(h.robot, { analyze: false }, true)
  assert.equal(h.context.busy, false)
  assert.equal(h.context.photoActive, false)
})

test('photo lease remains exclusive during image analysis and releases on analysis failure', async () => {
  const h = photoHarness()
  let rejectAnalysis
  const analysis = new Promise((resolve, reject) => { rejectAnalysis = reject })
  let analysisStarted
  const started = new Promise(resolve => { analysisStarted = resolve })
  h.context.describeImage = async () => {
    analysisStarted()
    return analysis
  }
  const first = h.photo(h.robot, { analyze: true })
  await started
  assert.equal(h.context.photoActive, true)
  await assert.rejects(h.photo(h.robot, { analyze: false }), /Camera busy/)
  rejectAnalysis(Error('vision service unavailable'))
  await assert.rejects(first, /vision service unavailable/)
  assert.equal(h.context.photoActive, false)
  assert.equal(h.context.busy, false)
})

test('camera failures still try stop and release the lock', async () => {
  for (const option of [{ failStart: true }, { failCapture: true }, { failStop: true }]) {
    const h = photoHarness(option)
    await assert.rejects(h.photo(h.robot, { analyze: false }))
    assert.equal(h.context.photoActive, false)
    assert.equal(h.context.busy, false)
    assert.ok(h.events.includes('stop'))
    assert.equal(h.context.photoDiagnostics.phase,'error')
    assert.equal(h.context.photoDiagnostics.saved,option.failStop===true)
    assert.ok(h.context.photoDiagnostics.errorStage)
  }
})

test('photo capture succeeds even if cloud image analysis is unavailable', async () => {
  const h = photoHarness()
  h.context.describeImage=async()=>({analysis:{status:'unconfigured'}})
  const result=await h.photo(h.robot,{analyze:true})
  assert.equal(result.image,'photo-42.jpg')
  assert.equal(h.context.photoDiagnostics.saved,true)
  assert.equal(h.context.photoDiagnostics.analysisStatus,'unconfigured')
  assert.equal(h.context.photoDiagnostics.phase,'analysis-unavailable')
})

test('photo diagnostic endpoint reports stages without user text or credential fields', () => {
  assert.match(lan,/else if\(request\.op==='\/photo\/status'\)result=photoStatus\(\)/)
  assert.match(lan,/photo:photoStatus\(\)/)
  assert.match(lan,/function photoStatus\(\)/)
  assert.match(direct,/撮影してSDカードに保存しました/)
  assert.match(direct,/写真を撮影できませんでした/)
})

const executeToolSource = direct.slice(
  direct.indexOf('    async function executeTool(name, args) {'),
  direct.indexOf('    async function recognitionTurn(text)', direct.indexOf('    async function executeTool(name, args) {')),
)
assert.ok(executeToolSource.includes('visualAllowedUntil'), 'tool must check camera authorization')
function dispatchHarness(permission, pending) {
  const context = {
    instance: {}, chat: null, recognitionTurnCurrent: () => false,
    photoHandler: async () => { context.captures++; return { image: 'new.jpg', analysis: { status: 'complete', text: 'OK' } } },
    photoTurn: pending, visualAllowedUntil: permission, captures: 0,
    memoryTools: [], trace: () => undefined, Date,
  }
  context.chat = context.instance
  return { context, execute: vm.runInNewContext(executeToolSource + '\nexecuteTool', context) }
}
test('camera tool refuses unsolicited requests and reuses direct capture', async () => {
  const noConsent = dispatchHarness(0)
  await assert.rejects(noConsent.execute('camera_describe', {}), /撮影依頼/)
  assert.equal(noConsent.context.captures, 0)
  const expiry = Date.now() + 1000
  const already = { expires: expiry, promise: Promise.resolve({ image: 'first.jpg', analysis: { status: 'complete', text: '済' } }) }
  const yesConsent = dispatchHarness(expiry, already)
  const result = await yesConsent.execute('camera_describe', {})
  assert.equal(result.photo, 'first.jpg')
  assert.equal(result.description, '済')
  assert.equal(yesConsent.context.captures, 0)
  assert.equal(yesConsent.context.visualAllowedUntil, 0)
})

test('conversation subtitle paths are bottom anchored, including error and camera analysis', () => {
  assert.equal((direct.match(/robot\.showBalloon\(/g) ?? []).length, 0, 'route all conversation balloons through the helper')
  assert.match(direct, /function showConversationBalloon\(message, options=\{\}, target=robot\)/)
  assert.match(direct, /return target\.showBalloon\(message, \{bottom:40,height:24,paddingY:4,\.\.\.options\}\)/)
  assert.match(lan, /robot\.showBalloon\(analysis\.text,\{bottom:40,height:24,paddingY:4\}\)/)
})

test('archive volume uses a bounded preview queue rather than an unbounded chain', () => {
  assert.match(volume, /new VolumePreviewQueue/)
  assert.match(volume, /previewQueue\?\.request\(volume\)/)
  assert.doesNotMatch(volume, /preview=preview\.then/)
})


// Integration of ASR final transcript -> local photo -> SD-linked history.
// Unlike parser-only tests, these exercise the actual onInputTranscript callback
// under both transcription-only and XiaoZhi-STT-to-text-LLM mode flags.
const transcriptStart = direct.indexOf('        onInputTranscript(text, more) {')
const transcriptEnd = direct.indexOf('        onOutputTranscript(text, more) {', transcriptStart)
assert.ok(transcriptStart >= 0 && transcriptEnd > transcriptStart, 'ASR callback exists')
const transcriptSource = direct.slice(transcriptStart, transcriptEnd).trim()
  .replace(/^onInputTranscript\(text, more\) \{/, 'function inputTranscript(text, more) {')
  .replace(/},\s*$/, '}')
function voicePhotoHarness({standalone, recognitionOnly}) {
  const records = [], photos = [], balloons = [], scheduled = []
  const instance = {}
  const voiceTurnTracker=createVoiceTurnTracker()
  const turnEpoch=voiceTurnTracker.begin()
  const context = {voiceTurnTracker,turnEpoch,
    chat: instance, instance, input: '', introText: '',
    standalone, recognitionOnly, state:'listening',retryAt:0,closed:0,
    closeChat(){ context.chat=undefined; context.closed++ },
    enrollment: {active: false},
    audioStats: {recognizedEvents: 0,lastTranscriptAt: 0},
    lastInputId: '', trace() {}, conversationIndicator() {},
    archive(role,text,eventId,image) { records.push({role,text,image}); return {id:'new-input'} },
    showConversationBalloon(message) { balloons.push(message) },
    currentSpeaker() { return {id:'known-speaker'} },
    modeCommandFromText() { return null },
    explicitVisualRequest: cameraIntent.explicitVisualRequest,
    directPhotoRequest: cameraIntent.directPhotoRequest,
    volumeRequest() { return false },
    volumeCommandFromText() { return null },
    headDirectionFromText() { return null },
    headHandled: undefined, visualAllowedUntil: 0,
    photoTurn: undefined, volumeTurn: undefined, volumeAllowedUntil: 0,
    async photoHandler(args) {
      photos.push(args)
      return {image: 'photo-new.jpg'}
    },
    running() { return true },
    Timer: {set(fn) { scheduled.push(fn); return scheduled.length }},
    Date, Promise,
  }
  const run=vm.runInNewContext(transcriptSource + '\ninputTranscript', context)
  return {context, run, records, photos, balloons, scheduled}
}

test('direct photo saves locally and records linked history in all voice modes', async () => {
  for(const mode of [
    {standalone:true,recognitionOnly:true},
    {standalone:false,recognitionOnly:true},
    {standalone:false,recognitionOnly:false},
  ]) {
    const h=voicePhotoHarness(mode)
    h.run('写真を撮ってください',false)
    assert.equal(h.records.filter(row=>row.role==='input').length,1)
    assert.ok(h.context.photoTurn, 'direct voice capture should be queued')
    await h.context.photoTurn.promise
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(h.photos.length,1,'no duplicate captures')
    assert.equal(h.photos[0].analyze,false,'photo-only request must not upload to AI')
    assert.equal(h.records.filter(row=>row.role==='output'&&row.image==='photo-new.jpg').length,1)
    assert.equal(h.scheduled.length,0,'direct photo must not launch another LLM turn')
    assert.ok(h.balloons.some(x=>x.includes('SDカードに保存')))
    assert.equal(h.context.closed,mode.recognitionOnly?1:0,'XiaoZhi ASR transport must be released')
    if(mode.recognitionOnly){
      assert.equal(h.context.state,'waiting')
      assert.ok(h.context.retryAt>Date.now(),'ASR reconnect must be scheduled')
    }
  }
})

test('negative and casual photo mentions never trigger local capture', async () => {
  for(const line of ['写真を撮らないで','写真について教えて','こんにちは','この写真を見て']) {
    const h=voicePhotoHarness({standalone:true,recognitionOnly:true})
    h.run(line,false)
    await Promise.resolve()
    assert.equal(h.photos.length,0,line)
    assert.equal(h.context.photoTurn,undefined,line)
  }
})

test('XiaoZhi STT with a text LLM may authorize vision without auto-capturing', () => {
  const h=voicePhotoHarness({standalone:false,recognitionOnly:true})
  h.run('カメラで見てください',false)
  assert.equal(h.photos.length,0,'description request must wait for authorized tool call')
  assert.ok(h.context.visualAllowedUntil>Date.now())
  assert.equal(h.scheduled.length,1,'text LLM receives non-direct visual request')
})

test('local photo handler keeps analysis opt-out and skips a second vision upload', async () => {
  assert.match(lan, /args=>photo\(robot,\{\.\.\.args,analyze:args\?\.analyze!==false\},true\)/)
  const expiry=Date.now()+1000
  const saved=dispatchHarness(expiry,{expires:expiry,promise:Promise.resolve({image:'only-saved.jpg'})})
  const result=await saved.execute('camera_describe',{})
  assert.equal(result.photo,'only-saved.jpg')
  assert.equal(result.saved,true)
  assert.equal(result.analysisStatus,'skipped')
  assert.match(result.error,/画像解析は実行していません/)
  assert.equal(saved.context.captures,0)
})


test('failed photo still restores recognition transport and displays a failure', async () => {
  const h=voicePhotoHarness({standalone:true,recognitionOnly:true})
  h.context.photoHandler=async()=>{throw Error('native camera unavailable')}
  h.run('写真撮って',false)
  await assert.rejects(h.context.photoTurn.promise,/native camera unavailable/)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(h.context.closed,1)
  assert.equal(h.context.state,'waiting')
  assert.ok(h.context.retryAt>Date.now())
  assert.ok(h.balloons.some(text=>text.includes('撮影できませんでした')))
  assert.equal(h.records.filter(row=>row.role==='output').length,0)
})


test('physical E2E expectation requires an explicit local photo in transcription-only mode', () => {
  const cases = JSON.parse(readFileSync(new URL('../voice-e2e-cases.json',import.meta.url),'utf8'))
  const row=cases.cases.find(item=>item.id==='mode_recognition_only_no_tool')
  assert.ok(row,'transcription photo E2E case exists')
  assert.ok(row.required.includes('photo'))
  assert.ok(!row.required.includes('no_photo'))
  assert.ok(row.required.includes('no_llm'))
})
