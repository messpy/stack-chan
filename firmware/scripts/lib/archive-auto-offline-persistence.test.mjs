import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const lan = readFileSync(new URL('../../host/app/lan-archive.js', import.meta.url), 'utf8')
const policy = readFileSync(new URL('../../host/app/archive-offline-policy.js', import.meta.url), 'utf8')
const chat = readFileSync(new URL('../../host/app/archive-direct-chat.js', import.meta.url), 'utf8')

function harness() {
  const events = []
  const settings = { chatMode: true, transcriptionMode: false, autoOffline: true }
  let usb = false
  let wifi = false
  let tick
  const context = {
    trace: message => events.push(['trace', message]),
    OfflinePolicy: vm.runInNewContext(policy.replace('export class', 'class') + '\nOfflinePolicy'),
    usbConnected: () => usb,
    getSettingsStatus: () => ({ connected: wifi, setupActive: false }),
    getSettings: () => settings,
    changeSettings: () => { throw Error('Automatic fallback must not mutate settings') },
    checkStatus: () => ({ running: false }),
    directChatStatus: () => ({ busy: false }),
    offlineStatus: () => ({ playing: false }),
    openOffline: options => events.push(['open', options]),
    closeOffline: () => events.push(['close']),
    suspendDirectChatForAutomaticOffline: () => events.push(['suspend']),
    resumeDirectChatFromAutomaticOffline: () => events.push(['resume']),
    Timer: { repeat(fn, frequency) { assert.equal(frequency, 1000); tick = fn } },
    busy: false,
  }
  const start = lan.indexOf('  const offlinePolicy=new OfflinePolicy();')
  const end = lan.indexOf('  startWeb(robot,{', start)
  assert.ok(start > 0 && end > start)
  vm.runInNewContext(lan.slice(start, end), context)
  return {
    tick: () => tick(),
    events,
    settings,
    setWifi: state => { wifi = state },
    setUsb: state => { usb = state },
  }
}

test('offline autopolicy never persists OFF and resumes prior desired ON when Wi-Fi returns', () => {
  const h = harness()
  for (let i = 0; i < 44; i++) h.tick()
  assert.equal(h.events.filter(([kind]) => kind === 'suspend').length, 1)
  assert.equal(h.events.filter(([kind]) => kind === 'open').length, 1)
  assert.equal(h.events.find(([kind]) => kind === 'open')[1].automatic, true)
  assert.equal(h.settings.chatMode, true)
  h.setWifi(true)
  h.tick()
  assert.deepEqual(h.events.filter(([kind]) => ['resume', 'close'].includes(kind)).map(([kind]) => kind), ['resume','close'])
  assert.equal(h.settings.chatMode, true)
  assert.equal(h.settings.transcriptionMode, false)
})

test('automatic offline does not fire if Wi-Fi connection is present', () => {
  const h = harness()
  h.setWifi(true)
  for (let i = 0; i < 60; i++) h.tick()
  assert.ok(!h.events.some(([kind]) => kind === 'open' || kind === 'suspend'))
})

test('native cloud suspends and resumes without ever touching SD settings', () => {
  const start = chat.indexOf('export function suspendDirectChatForAutomaticOffline(){')
  const end = chat.indexOf('export async function provisionDirectChat()', start)
  assert.ok(start > 0 && end > start)
  const code = chat.slice(start, end).replaceAll('export function', 'function')
  const events = []
  const context = {
    automaticOfflineSuspended: false,
    state: 'listening', retryAt: 0,
    running: () => true,
    pauseDirectChat: () => { events.push('pause'); return true },
    resumeDirectChat: () => { events.push('resume') },
    trace: line => events.push(line.trim()),
  }
  const routines = vm.runInNewContext(code + '\n({suspendDirectChatForAutomaticOffline,resumeDirectChatFromAutomaticOffline})', context)
  routines.suspendDirectChatForAutomaticOffline()
  routines.suspendDirectChatForAutomaticOffline()
  assert.equal(context.automaticOfflineSuspended, true)
  assert.deepEqual(events.filter(event => event === 'pause'), ['pause'])
  assert.equal(context.state, 'waiting')
  routines.resumeDirectChatFromAutomaticOffline()
  assert.equal(context.automaticOfflineSuspended, false)
  assert.deepEqual(events.filter(event => event === 'resume'), ['resume'])
  assert.match(chat, /if \(automaticOfflineSuspended \|\| connecting \|\| chat \|\| !running\(\)\) return/)
  assert.match(chat, /if \(automaticOfflineSuspended \|\| !running\(\)\) return/)
})
