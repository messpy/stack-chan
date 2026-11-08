import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CameraCaptureOptions, CameraFrame, RobotCamera } from '../../modules/camera/camera.js'
import { StackchanRuntimeCamera } from '../runtime-camera.js'

function frame(width = 1, height = 1): CameraFrame {
  return {
    width,
    height,
    imageType: 'rgb565le',
    buffer: new ArrayBuffer(width * height * 2),
  }
}

test('StackchanRuntimeCamera pauses touchPanel for an explicit camera session', async () => {
  const events: unknown[] = []
  const camera: RobotCamera = {
    available: true,
    start(options?: CameraCaptureOptions) {
      events.push(['camera.start', options])
    },
    stop() {
      events.push(['camera.stop'])
    },
    async capture(options?: CameraCaptureOptions) {
      events.push(['camera.capture', options])
      return frame(2, 2)
    },
  }
  const touchPanel = {
    stop() {
      events.push(['touch.stop'])
    },
    start() {
      events.push(['touch.start'])
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })
  await runtime.camera.start({ width: 2, height: 2, imageType: 'rgb565le' })
  const captured = await runtime.camera.capture({ width: 2, height: 2, imageType: 'rgb565le' })
  await runtime.camera.stop()

  assert.equal(runtime.camera.available, true)
  assert.equal(captured?.buffer.byteLength, 8)
  assert.deepEqual(events, [
    ['touch.stop'],
    ['camera.start', { width: 2, height: 2, imageType: 'rgb565le' }],
    ['camera.capture', { width: 2, height: 2, imageType: 'rgb565le' }],
    ['camera.stop'],
    ['touch.start'],
  ])
})

test('StackchanRuntimeCamera completes synchronous stop without adding a promise turn', () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
    },
    stop() {
      events.push('camera.stop')
    },
    async capture() {
      events.push('camera.capture')
      return frame()
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })

  runtime.camera.start()
  const result = runtime.camera.stop()

  assert.equal(result, undefined)
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'touch.start'])
})

test('StackchanRuntimeCamera waits for asynchronous stop before resuming touchPanel', async () => {
  const events: string[] = []
  let resolveStop: (() => void) | undefined
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
    },
    stop() {
      events.push('camera.stop')
      return new Promise<void>((resolve) => {
        resolveStop = resolve
      })
    },
    async capture() {
      events.push('camera.capture')
      return frame()
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })

  runtime.camera.start()
  const pending = runtime.camera.stop()
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop'])

  resolveStop?.()
  await pending

  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'touch.start'])
})

test('StackchanRuntimeCamera close releases camera before restoring touchPanel', () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
    },
    stop() {
      events.push('camera.stop')
    },
    close() {
      events.push('camera.close')
    },
    async capture() {
      events.push('camera.capture')
      return frame()
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })

  runtime.camera.start()
  const result = runtime.close()

  assert.equal(result, undefined)
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'camera.close', 'touch.start'])
})

test('StackchanRuntimeCamera keeps touch paused after capture until native camera closes', async () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
    },
    stop() {
      events.push('camera.stop')
    },
    async capture() {
      events.push('camera.capture')
      return frame()
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })
  await runtime.camera.capture()
  assert.deepEqual(events, ['touch.stop', 'camera.capture'])
  await runtime.camera.close()
  assert.deepEqual(events, ['touch.stop', 'camera.capture', 'camera.stop', 'touch.start'])
})

test('StackchanRuntimeCamera keeps touch paused after capture exception until confirmed close', async () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {},
    stop() { events.push('camera.stop') },
    async capture() { events.push('camera.capture'); throw new Error('sensor failed') },
  }
  const touchPanel = {
    stop() { events.push('touch.stop') },
    start() { events.push('touch.start') },
  }
  const runtime = new StackchanRuntimeCamera({camera, touchPanel})
  await assert.rejects(() => runtime.camera.capture(), /sensor failed/)
  assert.deepEqual(events, ['touch.stop', 'camera.capture'])
  await runtime.camera.close()
  assert.deepEqual(events, ['touch.stop', 'camera.capture', 'camera.stop', 'touch.start'])
})

test('StackchanRuntimeCamera keeps touch paused when camera start fails until confirmed close', async () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
      throw new Error('camera start failed')
    },
    stop() {
      events.push('camera.stop')
    },
    async capture() {
      events.push('camera.capture')
      return undefined
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })

  await assert.rejects(async () => runtime.camera.start(), /camera start failed/)
  assert.deepEqual(events, ['touch.stop', 'camera.start'])
  await runtime.camera.close()
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'touch.start'])
})

test('failed native close retains touch lock until successful retry', async () => {
  const events: string[] = []
  let failClose = true
  const camera: RobotCamera = {
    start() { events.push('camera.start') },
    stop() { events.push('camera.stop') },
    close() {
      events.push('camera.close')
      if (failClose) throw new Error('I2C busy')
    },
    async capture() { return frame() },
  }
  const touchPanel = {
    stop() { events.push('touch.stop') },
    start() { events.push('touch.start') },
  }
  const runtime = new StackchanRuntimeCamera({camera, touchPanel})
  await runtime.camera.start()
  await assert.rejects(async () => runtime.camera.close(), /I2C busy/)
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'camera.close'])
  failClose = false
  await runtime.camera.close()
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'camera.close', 'camera.stop', 'camera.close', 'touch.start'])
})

test('failed native stop must not resume shared touch before successful close', async () => {
  const events: string[] = []
  let failStop = true
  const camera: RobotCamera = {
    start() { events.push('camera.start') },
    stop() {
      events.push('camera.stop')
      if (failStop) throw new Error('stop failed')
    },
    close() { events.push('camera.close') },
    async capture() { return frame() },
  }
  const touchPanel = {
    stop() { events.push('touch.stop') },
    start() { events.push('touch.start') },
  }
  const runtime = new StackchanRuntimeCamera({camera, touchPanel})
  await runtime.camera.start()
  await assert.rejects(async () => runtime.camera.stop(), /stop failed/)
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop'])
  failStop = false
  await runtime.camera.close()
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'camera.stop', 'camera.close', 'touch.start'])
})

test('photo teardown callback identifies the last completed native stage', () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() { events.push('camera.start') },
    stop() { events.push('camera.stop') },
    close() { events.push('camera.close') },
    async capture() { return frame() },
  }
  const touchPanel = {
    stop() { events.push('touch.stop') },
    start() { events.push('touch.start') },
  }
  const runtime = new StackchanRuntimeCamera({camera, touchPanel})
  runtime.camera.start()
  const result = runtime.close(stage => events.push(stage))
  assert.equal(result, undefined)
  assert.deepEqual(events, [
    'touch.stop','camera.start',
    'CAMERA_STOP_BEGIN','camera.stop','CAMERA_STOP_DONE',
    'CAMERA_NATIVE_CLOSE_BEGIN','camera.close','CAMERA_NATIVE_CLOSE_DONE',
    'TOUCH_RESUME_BEGIN','touch.start','TOUCH_RESUME_DONE',
  ])
})

test('photo teardown callback stops at native close failure; touch stays paused', async () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() { events.push('camera.start') },
    stop() { events.push('camera.stop') },
    close() { events.push('camera.close'); throw new Error('native close stuck') },
    async capture() { return frame() },
  }
  const touchPanel = {
    stop() { events.push('touch.stop') },
    start() { events.push('touch.start') },
  }
  const runtime = new StackchanRuntimeCamera({camera, touchPanel})
  runtime.camera.start()
  await assert.rejects(async () => runtime.close(stage => events.push(stage)), /native close stuck/)
  assert.deepEqual(events, [
    'touch.stop','camera.start',
    'CAMERA_STOP_BEGIN','camera.stop','CAMERA_STOP_DONE',
    'CAMERA_NATIVE_CLOSE_BEGIN','camera.close',
  ])
})

test('failed touch restart is reported and retried only after native close', () => {
  const events: string[] = []
  let failTouchStart = true
  const camera: RobotCamera = {
    start() { events.push('camera.start') },
    stop() { events.push('camera.stop') },
    close() { events.push('camera.close') },
    async capture() { return frame() },
  }
  const touchPanel = {
    stop() { events.push('touch.stop') },
    start() {
      events.push('touch.start')
      if (failTouchStart) throw new Error('touch hardware not ready')
    },
  }
  const runtime = new StackchanRuntimeCamera({camera, touchPanel})
  const firstStages: string[] = []

  runtime.camera.start()
  assert.throws(
    () => runtime.close(stage => firstStages.push(stage)),
    /touch hardware not ready/,
  )
  assert.deepEqual(firstStages, [
    'CAMERA_STOP_BEGIN', 'CAMERA_STOP_DONE',
    'CAMERA_NATIVE_CLOSE_BEGIN', 'CAMERA_NATIVE_CLOSE_DONE',
    'TOUCH_RESUME_BEGIN',
  ])

  failTouchStart = false
  const retryStages: string[] = []
  assert.equal(runtime.close(stage => retryStages.push(stage)), undefined)
  assert.deepEqual(retryStages, [
    'CAMERA_STOP_BEGIN', 'CAMERA_STOP_DONE',
    'CAMERA_NATIVE_CLOSE_BEGIN', 'CAMERA_NATIVE_CLOSE_DONE',
    'TOUCH_RESUME_BEGIN', 'TOUCH_RESUME_DONE',
  ])
  assert.deepEqual(events, [
    'touch.stop', 'camera.start',
    'camera.stop', 'camera.close', 'touch.start',
    'camera.stop', 'camera.close', 'touch.start',
  ])
})
