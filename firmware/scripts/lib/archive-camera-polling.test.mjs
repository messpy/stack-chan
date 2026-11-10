import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'

const source = readFileSync(new URL('../../host/modules/camera/device/camera.ts', import.meta.url), 'utf8')

test('CoreS3 camera does not register native-to-JS frame callbacks',()=>{
  const start=source.indexOf('const camera = new ImageInCamera({')
  const end=source.indexOf('})',start)
  assert.ok(start>=0&&end>start,'NativeCamera constructed')
  const options=source.slice(start,end)
  assert.doesNotMatch(options,/\bonReadable\s*:/,'native callback must remain disabled')
  assert.match(source,/onReadable\?\s*:\s*\(\)\s*=>\s*void/,'constructor allows no callback')
})

test('frame polling continues to use native read with bounded initial wait',()=>{
  assert.match(source,/#takeFrame\(camera:\s*NativeImageInCamera\)[\s\S]*?return camera\.read\(\)/)
  assert.match(source,/pollMs:\s*INITIAL_FRAME_POLL_MS/)
  assert.match(source,/timeoutMs:\s*INITIAL_FRAME_TIMEOUT_MS/)
  assert.match(source,/const INITIAL_FRAME_POLL_MS\s*=\s*30/)
})

test('native start failure is traced without masking the original error',()=>{
  assert.match(source,/trace\('\[camera\] native start begin/)
  assert.match(source,/catch \(error\) \{[\s\S]*?native start threw[\s\S]*?throw error/)
  assert.match(source,/trace\('\[camera\] native start done/)
})
