import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runtime = readFileSync(new URL('../../host/app/runtime-camera.ts', import.meta.url), 'utf8')
const archive = readFileSync(new URL('../../host/app/lan-archive.js', import.meta.url), 'utf8')

test('runtime camera holds touch/I2C paused from capture until native camera close', () => {
  const classStart = runtime.indexOf('export class StackchanRuntimeCamera')
  const captureStart = runtime.indexOf('  async capture(', classStart)
  const capture = runtime.slice(captureStart, runtime.indexOf('  #pauseTouchPanel()', captureStart))
  assert.ok(capture.startsWith('  async capture('))
  assert.match(capture, /this\.#cameraActive\s*=\s*true/)
  assert.match(capture, /catch\s*\(error\)/)
  assert.doesNotMatch(capture, /finally\s*\{\s*if\s*\(!wasActive\)\s*this\.#resumeTouchPanel\(\)/)

  const closeStart = runtime.indexOf('  close(): ', classStart)
  const close = runtime.slice(closeStart, captureStart)
  assert.match(close, /this\.#camera\.close\?\.\(\)/)
  assert.match(close, /this\.#resumeTouchPanel\(\)/)
  assert.match(close, /return result\.then\(\(\) => finish\(\), fail\)/)
})

test('photo reports exact conversion/save stages and waits for camera close',()=>{
  const photo = archive.slice(archive.indexOf('async function photo('), archive.indexOf('async function describeImage('))
  assert.match(photo, /CAMERA_CAPTURE/)
  assert.match(photo, /JPEG_START/)
  assert.match(photo, /JPEG_DONE/)
  assert.match(photo, /SD_SAVE_START/)
  assert.match(photo, /CAMERA_SAVE/)
  assert.match(photo, /await robot\.camera\.close\(\)/)
  assert.ok(photo.indexOf('JPEG_START') < photo.indexOf('JPEG_DONE'))
  assert.ok(photo.indexOf('JPEG_DONE') < photo.indexOf('SD_SAVE_START'))
  assert.ok(photo.indexOf('SD_SAVE_START') < photo.indexOf('CAMERA_SAVE'))
})

test('photo recovery watchdog runs independently of JS during camera/JPEG/SD and is disarmed in finally',()=>{
  const native=readFileSync(new URL('../../host/app/archive-usb.c',import.meta.url),'utf8')
  const usb=readFileSync(new URL('../../host/app/archive-usb.js',import.meta.url),'utf8')
  const photo=archive.slice(archive.indexOf('async function photo('),archive.indexOf('async function describeImage('))
  assert.match(native, /#define SC_PHOTO_WATCHDOG_US 60000000LL/)
  assert.match(native, /esp_timer_start_once\(/)
  assert.match(native, /esp_restart\(\)/)
  assert.match(usb, /photoRecoveryWatchdog = native\('xs_archive_photo_watchdog'\)/)
  assert.ok(photo.indexOf('photoRecoveryWatchdog(true)')>=0)
  assert.ok(photo.indexOf('photoRecoveryWatchdog(true)')<photo.indexOf('robot.camera.capture'))
  assert.ok(photo.indexOf('photoRecoveryWatchdog(false)')>photo.indexOf('await robot.camera.close()'))
})
