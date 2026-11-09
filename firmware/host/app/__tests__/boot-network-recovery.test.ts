import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeAliasPackage(hostRoot, 'localization', resolve(hostRoot, 'modules/testing/fakes/localization.js'))

const {
  bootWiFiFailureMessage,
  classifyBootWiFiFailure,
  networkReadyResultForRecoveryChoice,
  shouldRetryBootWiFiAttempt,
  waitForBootWiFiRecoveryChoiceWithTimeout,
  resumeBootWiFi,
} = await import('../boot-network-recovery.js')

test('boot Wi-Fi retry helper respects the configured attempt limit', () => {
  assert.equal(shouldRetryBootWiFiAttempt(1, 3), true)
  assert.equal(shouldRetryBootWiFiAttempt(2, 3), true)
  assert.equal(shouldRetryBootWiFiAttempt(3, 3), false)
})

test('boot Wi-Fi helper detects scan exhaustion from network-service failures', () => {
  assert.equal(classifyBootWiFiFailure('Access point "home-ap" not found'), 'scan-exhausted')
  assert.equal(bootWiFiFailureMessage('Access point "home-ap" not found'), '保存済みWi-Fiが見つかりません')
})

test('boot Wi-Fi helper classifies non-scan failures as connection-failed', () => {
  assert.equal(classifyBootWiFiFailure('authentication failed'), 'connection-failed')
  assert.equal(bootWiFiFailureMessage('authentication failed'), 'Wi-Fi接続に失敗しました')
})

test('boot Wi-Fi helper maps offline choice to a skipped network readiness result', () => {
  assert.deepEqual(networkReadyResultForRecoveryChoice('offline', 'authentication failed'), {
    status: 'skipped',
    reason: 'offline start selected: connection-failed',
  })
  assert.equal(networkReadyResultForRecoveryChoice('retry', 'authentication failed'), undefined)
  resumeBootWiFi()
})


test('missing Wi-Fi credentials display a non-sensitive explanation', () => {
  assert.equal(classifyBootWiFiFailure('missing Wi-Fi credentials'), 'missing-credentials')
  assert.equal(bootWiFiFailureMessage('missing Wi-Fi credentials'), 'Wi-Fiの設定がありません')
})

test('recovery prompt expires to offline exactly once', async () => {
  let fire: (() => void) | undefined
  let choose: ((choice: 'retry' | 'offline') => void) | undefined
  let cleared = 0, restored = 0, timedOut = 0
  const pending = waitForBootWiFiRecoveryChoiceWithTimeout(
    { set(fn, ms) { assert.equal(ms, 15000); fire = fn; return 1 },
      clear(handle) { assert.equal(handle, 1); cleared++ } },
    (select) => { choose = select },
    () => { restored++ }, undefined, () => { timedOut++ },
  )
  assert.ok(fire)
  fire()
  assert.equal(await pending, 'offline')
  choose?.('retry')
  assert.deepEqual([cleared, restored, timedOut], [1, 1, 1])
})

test('manual retry clears the deadline', async () => {
  let fire: (() => void) | undefined
  let cleared = 0, restored = 0
  const pending = waitForBootWiFiRecoveryChoiceWithTimeout(
    { set(fn) { fire = fn; return 1 }, clear() { cleared++ } },
    (choose) => choose('retry'), () => { restored++ },
  )
  assert.equal(await pending, 'retry')
  fire?.()
  assert.deepEqual([cleared, restored], [1, 1])
})

test('broken recovery UI selects offline and restores input', async () => {
  let restored = 0
  const result = await waitForBootWiFiRecoveryChoiceWithTimeout(
    { set() { return 1 }, clear() {} },
    () => { throw Error('UI unavailable') }, () => { restored++ },
  )
  assert.equal(result, 'offline')
  assert.equal(restored, 1)
})
