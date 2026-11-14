import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'
import { createOptionalIMU } from '../../../app/optional-imu.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeAliasPackage(modulesRoot, 'imu-motion', resolve(modulesRoot, 'input/imu-motion.js'))
writeAliasPackage(modulesRoot, 'input-event', resolve(modulesRoot, 'input/input-event.js'))
writeAliasPackage(modulesRoot, 'time', resolve(modulesRoot, 'testing/fakes/time.js'), { hasDefaultExport: true })
writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
const { default: IMU } = await import('../imu.js')

test('healthy IMU constructor and configure preserve normal motion input', () => {
  let configured = 0
  let closed = 0
  const lines: string[] = []
  ;(globalThis as typeof globalThis & { trace: (line: string) => void }).trace = line => lines.push(line)
  class HealthySensor {
    sample() { return {} }
    configure(_options: unknown) { configured++ }
    close() { closed++ }
  }
  const imu = createOptionalIMU(() => new IMU(HealthySensor))
  assert.ok(imu)
  assert.equal(configured, 1)
  imu.start()
  imu.stop()
  imu.close()
  assert.equal(closed, 1)
  assert.equal(lines.filter(s => s.includes('initialization failed')).length, 0)
})

test('failed IMU hardware constructor degrades instead of stopping startup', () => {
  const lines: string[] = []
  ;(globalThis as typeof globalThis & { trace: (line: string) => void }).trace = line => lines.push(line)
  class MissingSensor {
    constructor() { throw new Error('sensor unavailable') }
    sample() { return {} }
  }
  let notified = 0
  const imu = createOptionalIMU(() => new IMU(MissingSensor), () => notified++)
  assert.equal(imu, undefined)
  assert.equal(notified, 1)
  assert.ok(lines.includes('[IMU] initialization failed stage=constructor\n'))
  assert.ok(lines.every(line => !line.includes('sensor unavailable')))
})

test('failed IMU configure closes the driver exactly once and continues startup', () => {
  const lines: string[] = []
  ;(globalThis as typeof globalThis & { trace: (line: string) => void }).trace = line => lines.push(line)
  let closed = 0
  class BadConfiguration {
    sample() { return {} }
    configure() { throw new Error('I2C failure') }
    close() { closed++ }
  }
  const imu = createOptionalIMU(() => new IMU(BadConfiguration))
  assert.equal(imu, undefined)
  assert.equal(closed, 1)
  assert.ok(lines.includes('[IMU] initialization failed stage=configure\n'))
  assert.ok(lines.every(line => !line.includes('I2C failure')))
})

test('cleanup failure does not hide the original IMU configuration failure', () => {
  const lines: string[] = []
  ;(globalThis as typeof globalThis & { trace: (line: string) => void }).trace = line => lines.push(line)
  const problem = new Error('configure failure')
  class BrokenCleanup {
    sample() { return {} }
    configure() { throw problem }
    close() { throw new Error('cleanup failure') }
  }
  let failure: unknown
  const imu = createOptionalIMU(() => new IMU(BrokenCleanup), e => { failure = e })
  assert.equal(imu, undefined)
  assert.equal(failure, problem)
  assert.ok(lines.includes('[IMU] initialization cleanup failed\n'))
})
