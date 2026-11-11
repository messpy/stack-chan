import { lstatSync, readlinkSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertNoCustomBuildOutput,
  buildOutputDirectory,
  firmwareDirectory,
  hostApplicationName,
  moddableOutputArguments,
} from './build-output.mjs'

test('build output configuration is repository-local and stable', () => {
  assert.equal(hostApplicationName, 'stack-chan-host')
  assert.equal(buildOutputDirectory, `${firmwareDirectory}/dist`)
  const [flag, outputPath] = moddableOutputArguments()
  assert.equal(flag, '-o')
  if (process.platform === 'linux' && buildOutputDirectory.length >= 80) {
    assert.ok(outputPath.length < buildOutputDirectory.length)
    assert.ok(lstatSync(outputPath).isSymbolicLink())
    assert.equal(readlinkSync(outputPath), buildOutputDirectory)
  } else {
    assert.equal(outputPath, buildOutputDirectory)
  }
})

test('custom Moddable output directories are rejected', () => {
  assert.throws(() => assertNoCustomBuildOutput(['-o', '/tmp/elsewhere']), /fixed to/)
  assert.throws(() => assertNoCustomBuildOutput(['-o=/tmp/elsewhere']), /fixed to/)
  assert.doesNotThrow(() => assertNoCustomBuildOutput(['-d', '-m']))
})
