import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeStartupFailureRecord } from '../../host/app/startup-diagnostics.js'

test('behavior failure identifies archive import and retains only fixed, safe fields', () => {
  const record = makeStartupFailureRecord({
    phase: 'behavior', checkpoint: 'archive-import', errorClass: 'ReferenceError',
    resetReason: 11, heap: {internalFree: 42000, internalLargest: 21000, psramFree: 6000000,
      token: 'SECRET_HEAP', ssid: 'SECRET_NETWORK'},
    message: 'SECRET_EXCEPTION', stack: 'SECRET_STACK',
  })
  assert.equal(record.component, 'archive-import')
  assert.equal(record.stage, 115)
  assert.equal(record.phase, 'behavior')
  assert.equal(record.error, 'ReferenceError')
  assert.equal(record.componentState, 'failed')
  assert.equal(record.internalFree, 42000)
  assert.equal(record.resetReason, 11)
  assert.deepEqual(Object.keys(record), [
    'event', 'component', 'componentState', 'phase', 'error', 'reason', 'site',
    'sequence', 'stage', 'previousValid', 'previousSequence', 'previousStage',
    'previousError', 'resetReason', 'internalFree', 'internalLargest', 'psramFree',
  ])
  assert.ok(!JSON.stringify(record).includes('SECRET'))
  assert.ok(JSON.stringify(record).length < 400)
})

test('all startup checkpoints are distinct and compatible with the USB safe-line filter', () => {
  const checkpoints = [
    'dock-start', 'platform-input', 'localization', 'timezone', 'behavior-resolve',
    'on-launch', 'miniapp-prepare', 'network-start', 'network-ready',
    'preferences', 'context-create', 'dock-context', 'miniapp-register',
    'context-behaviors', 'archive-import', 'archive-start', 'finalize',
  ]
  const seen = new Set()
  const acceptedComponents = new Set([
    'dock-context', 'runtime-input', 'runtime-ui', 'runtime-timer',
    'default-behavior', 'experimental-miniapps', 'runtime',
    'preferences', 'context-behaviors', 'archive-import', 'archive-start',
  ])
  for (const checkpoint of checkpoints) {
    const record = makeStartupFailureRecord({phase: 'behavior', checkpoint, errorClass: 'ReferenceError'})
    assert.ok(acceptedComponents.has(record.component))
    assert.ok(record.stage > 100)
    assert.ok(!seen.has(record.stage))
    seen.add(record.stage)
  }
  assert.equal(seen.size, 17)
})

test('unknown input and scalar anomalies fail closed without copying private values', () => {
  const r = makeStartupFailureRecord({
    phase: 'SECRET_PHASE', checkpoint: 'SECRET_CHECKPOINT', errorClass: 'SECRET_ERROR',
    resetReason: -1, heap: {internalFree: Infinity, internalLargest: '123', psramFree: -2},
  })
  assert.equal(r.phase, 'unknown')
  assert.equal(r.component, 'runtime')
  assert.equal(r.stage, 0)
  assert.equal(r.error, 'unknown')
  assert.equal(r.internalFree, 0)
  assert.equal(r.internalLargest, 0)
  assert.equal(r.psramFree, 0)
  assert.equal(r.resetReason, 0)
  assert.ok(!JSON.stringify(r).includes('SECRET'))
  assert.equal(makeStartupFailureRecord().phase, 'unknown')
})
