import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOptionalIMU } from '../optional-imu.js'

test('healthy optional IMU remains available', () => {
  const original = { start() {}, close() {} }
  let failures = 0
  const imu = createOptionalIMU(() => original, () => failures++)
  assert.equal(imu, original)
  assert.equal(failures, 0)
})

test('sensor constructor failure is isolated from the rest of startup', () => {
  const problem = new Error('device unavailable')
  let captured: unknown
  const imu = createOptionalIMU(
    () => { throw problem },
    error => { captured = error },
  )
  assert.equal(imu, undefined)
  assert.equal(captured, problem)
})

test('diagnostic callback failure cannot stop local startup', () => {
  const imu = createOptionalIMU(
    () => { throw Error('failed hardware') },
    () => { throw Error('logging unavailable') },
  )
  assert.equal(imu, undefined)
})

test('sensor absent does not invoke optional IMU construction', () => {
  let created = false
  const sensorAvailable = false
  const imu = sensorAvailable ? createOptionalIMU(() => { created = true; return 1 }) : undefined
  assert.equal(imu, undefined)
  assert.equal(created, false)
})
