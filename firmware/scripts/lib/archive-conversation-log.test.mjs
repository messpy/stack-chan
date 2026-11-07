import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const source = readFileSync(new URL('../../host/app/archive-debug.js', import.meta.url), 'utf8')

async function createSubject() {
  const lines = []
  let connected = true
  const context = createContext({ trace: (value) => lines.push(String(value)) })
  const exports = {
    heapStatus: () => ({}),
    initDebugLog: () => {},
    pushDebugLog: () => {},
    popDebugLog: () => undefined,
    debugLogStatus: () => ({}),
    usbConnected: () => connected,
    writeDebugUSB: () => true,
  }
  const usb = new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
  }, { context })
  const timer = new SyntheticModule(['default'], function () {
    this.setExport('default', { repeat: () => 1 })
  }, { context })
  const subject = new SourceTextModule(source, { context })
  await subject.link((name) => {
    if (name === 'archive-usb') return usb
    if (name === 'timer') return timer
    throw new Error('Unexpected module: ' + name)
  })
  await subject.evaluate()
  return { log: subject.namespace, lines, connect(value) { connected = value } }
}

test('conversation diagnostics opt-in and USB-only', async () => {
  const { log, lines, connect } = await createSubject()
  log.traceConversation('ASR_FINAL', 'secret speech')
  assert.equal(lines.length, 0)
  assert.equal(log.configureConversationLog().enabled, false)
  connect(false)
  assert.throws(() => log.configureConversationLog(true), /USB connection required/)
  connect(true)
  assert.equal(log.configureConversationLog(true).enabled, true)
  log.traceConversation('ASR_FINAL', 'こんにちは')
  assert.match(lines.join(''), /ASR_FINAL.*こんにちは/)
  log.configureConversationLog(false)
  log.traceConversation('AI_RESPONSE', 'should not be logged')
  assert.doesNotMatch(lines.join(''), /should not be logged/)
})

test('text logs are bounded, chunked and do not include control characters', async () => {
  const { log, lines } = await createSubject()
  log.configureConversationLog(true)
  log.traceConversation('ASR_FINAL', 'a'.repeat(5000) + '\n')
  assert.ok(lines.length > 1)
  assert.ok(lines.every((line) => line.length < 350))
  assert.match(lines.at(-1), /truncated=true/)
  assert.equal(lines.filter((line) => line.includes('text=')).reduce((n, line) => n + (line.split('text=')[1]?.replace(/\n$/, '').length || 0), 0), 4096)
})

test('disconnect disables transcript logging', async () => {
  const { log, lines, connect } = await createSubject()
  log.configureConversationLog(true)
  connect(false)
  log.traceConversation('AI_RESPONSE', 'private')
  connect(true)
  log.traceConversation('AI_RESPONSE', 'private after reconnect')
  assert.equal(lines.length, 0)
  assert.equal(log.configureConversationLog().enabled, false)
})
