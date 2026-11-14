import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { archiveBuildPreflight } from './archive-build-preflight.mjs'
import { prepareCoreS3IdfDependencies } from './idf-dependencies.mjs'

test('archive detection preserves unrelated target builds', () => {
  const args = ['-m', '-p', 'esp32/m5stack_cores3', '-t', 'build', '/project/manifest_archive_private.json']
  assert.deepEqual(archiveBuildPreflight(args), { platformName: 'm5stack_cores3', mode: 'release', archive: true })
  assert.equal(archiveBuildPreflight(['-p', 'esp32/m5stack', '/project/manifest_archive_private.json']), null)
  assert.equal(archiveBuildPreflight(['-p', 'esp32/m5stack_cores3', '/project/manifest_local.json']), null)
  assert.equal(archiveBuildPreflight(['-d', ...args]).mode, 'debug')
  assert.equal(archiveBuildPreflight(['-i', ...args]).mode, 'instrument')
})

test('camera, JPEG and audio codec are all seeded once; replay/clean is stable', () => {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-archive-preflight-'))
  const config = { outputDirectory, platformName: 'm5stack_cores3', applicationName: 'stack-chan-host', mode: 'release', archive: true }
  try {
    const file = prepareCoreS3IdfDependencies(config)
    const first = readFileSync(file, 'utf8')
    for (const name of ['esp32-camera', 'esp_jpeg', 'esp_audio_codec'])
      assert.equal(first.split('espressif/' + name + ':').length - 1, 1, name)
    prepareCoreS3IdfDependencies(config)
    assert.equal(readFileSync(file, 'utf8'), first)
    rmSync(path.join(outputDirectory, 'tmp'), { recursive: true, force: true })
    const recreated = prepareCoreS3IdfDependencies(config)
    assert.equal(readFileSync(recreated, 'utf8'), first)
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
})
