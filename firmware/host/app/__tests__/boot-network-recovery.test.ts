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

test('unattended Wi-Fi recovery falls back to offline and ignores stale taps', async () => {
  let fireTimeout: (() => void) | undefined
  let clearCount = 0
  let cleanupCount = 0
  let timeoutCount = 0
  let choose: ((choice: 'retry' | 'offline') => void) | undefined
  const timer = {
    set(callback: () => void, interval: number) {
      assert.equal(interval, 10000)
      fireTimeout = callback
      return 1
    },
    clear(handle: unknown) {
      assert.equal(handle, 1)
      clearCount++
    },
  }

  const result = waitForBootWiFiRecoveryChoiceWithTimeout(
    timer,
    (select) => {
      choose = select
    },
    () => cleanupCount++,
    undefined,
    () => timeoutCount++,
  )
  assert.ok(fireTimeout)
  fireTimeout()
  assert.equal(await result, 'offline')
  choose?.('retry')
  assert.equal(clearCount, 1)
  assert.equal(cleanupCount, 1)
  assert.equal(timeoutCount, 1)
})

test('manual Wi-Fi retry cancels automatic offline fallback and restores controls once', async () => {
  let fireTimeout: (() => void) | undefined
  let cleanupCount = 0
  let clearCount = 0
  const result = waitForBootWiFiRecoveryChoiceWithTimeout(
    {
      set(callback: () => void) {
        fireTimeout = callback
        return 2
      },
      clear() {
        clearCount++
      },
    },
    (select) => select('retry'),
    () => cleanupCount++,
  )
  assert.equal(await result, 'retry')
  fireTimeout?.()
  assert.equal(clearCount, 1)
  assert.equal(cleanupCount, 1)
})

test('recovery prompt or timer setup failure does not block offline boot', async () => {
  const timer = {
    set() {
      return 3
    },
    clear() {},
  }
  let cleanupCount = 0
  const result = waitForBootWiFiRecoveryChoiceWithTimeout(
    timer,
    () => {
      throw new Error('recovery UI unavailable')
    },
    () => cleanupCount++,
  )
  assert.equal(await result, 'offline')
  assert.equal(cleanupCount, 1)

  const timerFailure = waitForBootWiFiRecoveryChoiceWithTimeout(
    {
      set(): number {
        throw new Error('timer unavailable')
      },
      clear() {},
    },
    () => {
      throw new Error('must not show UI without timer')
    },
    () => cleanupCount++,
  )
  assert.equal(await timerFailure, 'offline')
  assert.equal(cleanupCount, 2)
})
