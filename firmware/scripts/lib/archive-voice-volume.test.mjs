import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const direct = readFileSync(new URL('../../host/app/archive-direct-chat.js', import.meta.url), 'utf8')
const tools = readFileSync(new URL('../../host/app/archive-tools.js', import.meta.url), 'utf8')
const start = direct.indexOf('function volumeRequest(text)')
const end = direct.indexOf('let refreshAITalk', start)
assert.ok(start >= 0 && end > start)
const parse = vm.runInNewContext(direct.slice(start, end) + '\n({volumeRequest,volumeCommandFromText})')

test('natural Japanese volume directives are parsed without expanding unsafe requests', () => {
  assert.equal(parse.volumeCommandFromText('音量を20パーセントにして').percent, 20)
  assert.equal(parse.volumeCommandFromText('音量を30％にして').percent, 30)
  assert.equal(parse.volumeCommandFromText('音量上げて').delta, 10)
  assert.equal(parse.volumeCommandFromText('音量を下げて').delta, -10)
  assert.equal(parse.volumeCommandFromText('音量を100%にして').percent, 100)
  for (const line of ['音量を120パーセントにして', '音量を変えないで', '音量の話をしよう', '音量上げないで', '写真撮って'])
    assert.equal(parse.volumeCommandFromText(line), null, line)
})

const code = direct.slice(direct.indexOf('    async function executeTool(name, args) {'), direct.indexOf('    async function recognitionTurn(text)'))
function mock(authorization, prior) {
  const events = []
  const context = {
    chat: null, instance: {}, recognitionTurnCurrent: () => false,
    photoHandler: () => undefined, photoTurn: undefined, visualAllowedUntil: 0,
    volumeTurn: prior, volumeAllowedUntil: authorization, getVolume: () => ({ percent: 20 }),
    setVolume(percent) { events.push(percent); return { percent } },
    memoryTools: [], trace: () => undefined, Date,
  }
  context.chat = context.instance
  return { context, events, execute: vm.runInNewContext(code + '\nexecuteTool', context) }
}

test('volume cloud tool calls need a current recognized user request', async () => {
  const h = mock(0)
  await assert.rejects(h.execute('volume_set', { percent: 30 }), /依頼がありません/)
  assert.deepEqual(h.events, [])
  assert.equal((await h.execute('volume_get', {})).percent, 20)
})

test('AI echoes of a directly applied change do not adjust output twice', async () => {
  const now = Date.now()
  const h = mock(now + 12000, { at: now, result: { percent: 30 } })
  const reply = await h.execute('volume_set', { percent: 30 })
  assert.equal(reply.duplicate, true)
  assert.equal(reply.percent, 30)
  assert.deepEqual(h.events, [])
  await assert.rejects(h.execute('volume_set', { percent: 40 }), /一度だけ/)
})

test('unrecognized numeric directive can be applied once if authorization is fresh', async () => {
  const h = mock(Date.now() + 12000)
  assert.equal((await h.execute('volume_set', { percent: 25 })).percent, 25)
  assert.deepEqual(h.events, [25])
  await assert.rejects(h.execute('volume_set', { percent: 25 }), /依頼がありません/)
})

test('voice tool definitions dispatch before timer clock synchronization', () => {
  assert.match(tools, /name:'volume_get'/)
  assert.match(tools, /name:'volume_set'/)
  assert.match(tools, /if\(name==='volume_get'\)return getVolume\(\)/)
  assert.match(tools, /if\(name==='volume_set'\)return setVolume\(args\.percent\)/)
})
