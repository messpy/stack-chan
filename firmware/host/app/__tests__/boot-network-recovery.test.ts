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

test('boot Wi-Fi helper identifies missing credentials without exposing details', () => {
  assert.equal(classifyBootWiFiFailure('missing Wi-Fi credentials'), 'missing-credentials')
  assert.equal(bootWiFiFailureMessage('missing Wi-Fi credentials'), 'Wi-Fiの設定がありません')
})

test('boot Wi-Fi helper classifies non-scan failures as connection-failed', () => {
  assert.equal(classifyBootWiFiFailure('authentication failed'), 'connection-failed')
  assert.equal(bootWiFiFailureMessage('authentication failed'), 'Wi-Fi接続に失敗しました')
})

test('boot Wi-Fi helper maps offline choice to a skipped network readiness result', () => {
  assert.deepEqual(networkReadyResultForRecoveryChoice('offline', 'authentication failed'), {
    status: 'skipped',
    reason: 'offline start selected: authentication failed',
  })
  assert.equal(networkReadyResultForRecoveryChoice('retry', 'authentication failed'), undefined)
})

test('recovery choice automatically falls back to offline after its deadline', async () => {
  let callback: (() => void) | undefined
  let cleared = 0
  let restored = 0
  let timedOut = 0
  let choose: ((choice: 'retry' | 'offline') => void) | undefined
  const pending = waitForBootWiFiRecoveryChoiceWithTimeout(
    {
      set(fn: () => void, milliseconds: number) {
        assert.equal(milliseconds, 15000)
        callback = fn
        return 1
      },
      clear(handle: number) {
        assert.equal(handle, 1)
        cleared++
      },
    },
    (select) => { choose = select },
    () => restored++,
    undefined,
    () => timedOut++,
  )
  assert.ok(callback)
  callback()
  assert.equal(await pending, 'offline')
  choose?.('retry')
  assert.equal(cleared, 1)
  assert.equal(restored, 1)
  assert.equal(timedOut, 1)
})

test('manual retry restores input and cancels timeout', async () => {
  let fire: (() => void) | undefined
  let cleaned = 0
  const promise = waitForBootWiFiRecoveryChoiceWithTimeout(
    {
      set(fn: () => void) { fire = fn; return 1 },
      clear() { cleaned++ },
    },
    (choose) => choose('retry'),
    () => cleaned++,
  )
  assert.equal(await promise, 'retry')
  fire?.()
  assert.equal(cleaned, 2)
})

test('unavailable recovery timer or UI fails safely to offline', async () => {
  let cleaned = 0
  const choice = waitForBootWiFiRecoveryChoiceWithTimeout(
    {
      set(): number { throw new Error('timer allocation failed') },
      clear() {},
    },
    () => { throw new Error('must not display') },
    () => cleaned++,
  )
  assert.equal(await choice, 'offline')
  const brokenUI = waitForBootWiFiRecoveryChoiceWithTimeout(
    {
      set() { return 1 },
      clear() {},
    },
    () => { throw new Error('UI unavailable') },
    () => cleaned++,
  )
  assert.equal(await brokenUI, 'offline')
  assert.equal(cleaned, 2)
})
