import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertNoCustomBuildOutput,
  buildOutputDirectory,
  firmwareDirectory,
  hostApplicationName,
  moddableOutputArguments,
} from './build-output.mjs'
import { moddableMakeEnvironment } from './moddable-make.mjs'

test('build output configuration is repository-local and stable', () => {
  assert.equal(hostApplicationName, 'stack-chan-host')
  assert.equal(buildOutputDirectory, `${firmwareDirectory}/dist`)
  assert.deepEqual(moddableOutputArguments(), ['-o', buildOutputDirectory])
})

test('custom Moddable output directories are rejected', () => {
  assert.throws(() => assertNoCustomBuildOutput(['-o', '/tmp/elsewhere']), /fixed to/)
  assert.throws(() => assertNoCustomBuildOutput(['-o=/tmp/elsewhere']), /fixed to/)
  assert.doesNotThrow(() => assertNoCustomBuildOutput(['-d', '-m']))
})

test('Linux ESP32 make passes an oversized module list to xsl in a response file', {
  skip: process.platform !== 'linux',
}, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stackchan-xsl-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const modulesDirectory = join(root, 'modules')
  const modules = Array.from({ length: 1600 }, (_, index) => `${modulesDirectory}/${'module'.repeat(10)}-${index}.xsb`)
  const makefile = join(root, 'makefile')
  const source = [
    'PLATFORM = esp32',
    `TMP_DIR = ${root}`,
    `MODULES_DIR = ${modulesDirectory}`,
    'PRELOADS = -p main.xsb',
    'STRIPS = -s "*"',
    'CREATION = -c 1,2,3',
    `MODULES = ${modules.join(' ')}`,
    'all:',
    '\txsl -b $(MODULES_DIR) -o $(TMP_DIR) $(PRELOADS) $(STRIPS) $(CREATION) $(MODULES)',
  ].join('\n')
  writeFileSync(makefile, source)

  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'xsl'), '#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = args.txt ] && cp "$1" xsl.received\n', {
    mode: 0o755,
  })
  const env = moddableMakeEnvironment({ ...process.env, PATH: `${bin}:${process.env.PATH}` })
  const result = spawnSync('make', ['-f', makefile], { env, stdio: 'inherit' })
  assert.ifError(result.error)
  assert.equal(result.status, 0)
  const received = readFileSync(join(root, 'xsl.received'), 'utf8')
  assert.ok(Buffer.byteLength(received) > 128 * 1024)
  assert.deepEqual(received.trim().split(/\s+/), [
    '-b',
    modulesDirectory,
    '-o',
    root,
    '-p',
    'main.xsb',
    '-s',
    '"*"',
    '-c',
    '1,2,3',
    ...modules,
  ])
  assert.equal(readFileSync(makefile, 'utf8'), source)
})
