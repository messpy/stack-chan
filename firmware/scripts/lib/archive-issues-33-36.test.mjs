import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

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
    Date, trace: () => undefined, id: () => '42',
    encodeJPEG: () => new Uint8Array([1, 2, 3]),
    save: () => events.push('save'),
    describeImage: async () => ({ analysis: { status: 'complete', text: '確認' } }),
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

test('camera failures still try stop and release the lock', async () => {
  for (const option of [{ failStart: true }, { failCapture: true }, { failStop: true }]) {
    const h = photoHarness(option)
    await assert.rejects(h.photo(h.robot, { analyze: false }))
    assert.equal(h.context.photoActive, false)
    assert.equal(h.context.busy, false)
    assert.ok(h.events.includes('stop'))
  }
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
  assert.equal((direct.match(/robot\.showBalloon\(/g) ?? []).length, 1, 'route all conversation balloons through the helper')
  assert.match(direct, /function showConversationBalloon\(message, options=\{\}\)/)
  assert.match(direct, /return robot\.showBalloon\(message, \{bottom:40,height:24,paddingY:4,\.\.\.options\}\)/)
  assert.match(lan, /robot\.showBalloon\(analysis\.text,\{bottom:40,height:24,paddingY:4\}\)/)
})

test('archive volume uses a bounded preview queue rather than an unbounded chain', () => {
  assert.match(volume, /new VolumePreviewQueue/)
  assert.match(volume, /previewQueue\?\.request\(volume\)/)
  assert.doesNotMatch(volume, /preview=preview\.then/)
})
