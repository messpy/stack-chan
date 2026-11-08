import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consumeOfflineBootRequest, requestOfflineBoot } from '../offline-boot-request.js'

test('offline boot is explicitly requested and consumed exactly once', () => {
  assert.equal(consumeOfflineBootRequest(), false)
  requestOfflineBoot()
  assert.equal(consumeOfflineBootRequest(), true)
  assert.equal(consumeOfflineBootRequest(), false)
})

test('repeated requests do not persist beyond the next boot', () => {
  requestOfflineBoot()
  requestOfflineBoot()
  assert.equal(consumeOfflineBootRequest(), true)
  assert.equal(consumeOfflineBootRequest(), false)
})
