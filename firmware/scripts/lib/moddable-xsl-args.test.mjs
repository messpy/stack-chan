import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { prepareModdableXslArgsFile, restoreModdableXslArgsFile } from './moddable-xsl-args.mjs'

const original = '\txsl -b $(MODULES_DIR) -o $(TMP_DIR) $(PRELOADS) $(STRIPS) $(CREATION) $(MODULES)'
const source = 'if ((argc == 2) && (c_strcmp(argv[1], "args.txt") == 0)) { /* supported */ }\n'

function fixture(recipe = original, supportsArgFile = true) {
  const sdk = mkdtempSync(path.join(tmpdir(), 'stackchan-xsl-args-'))
  const template = path.join(sdk, 'tools/mcconfig/make.esp32.mk')
  const xslSource = path.join(sdk, 'xs/tools/xsl.c')
  mkdirSync(path.dirname(template), { recursive: true })
  mkdirSync(path.dirname(xslSource), { recursive: true })
  writeFileSync(template, 'all:\n\t@echo preflight\n' + recipe + '\n')
  writeFileSync(xslSource, supportsArgFile ? source : 'int main() {}\n')
  return { sdk, template }
}

test('patches the upstream ESP32 xsl recipe once; restores without losing other lines', () => {
  const { sdk, template } = fixture()
  try {
    assert.equal(prepareModdableXslArgsFile({ moddableDirectory: sdk }).status, 'patched')
    const patched = readFileSync(template, 'utf8')
    assert.match(patched, /\$\(file >\$\(TMP_DIR\)\/args\.txt,/)
    assert.match(patched, /cd "\$\(TMP_DIR\)" && xsl args\.txt/)
    assert.equal(prepareModdableXslArgsFile({ moddableDirectory: sdk }).status, 'already-patched')
    assert.equal(readFileSync(template, 'utf8'), patched)
    assert.equal(restoreModdableXslArgsFile({ moddableDirectory: sdk }).status, 'restored')
    assert.equal(readFileSync(template, 'utf8'), 'all:\n\t@echo preflight\n' + original + '\n')
    assert.equal(restoreModdableXslArgsFile({ moddableDirectory: sdk }).status, 'already-original')
  } finally {
    rmSync(sdk, { recursive: true, force: true })
  }
})

test('refuses unknown recipes and SDKs without xsl args.txt support', () => {
  for (const [recipe, supported] of [['\txsl unexpected', true], [original, false]]) {
    const { sdk, template } = fixture(recipe, supported)
    const before = readFileSync(template, 'utf8')
    try {
      assert.throws(() => prepareModdableXslArgsFile({ moddableDirectory: sdk }))
      assert.equal(readFileSync(template, 'utf8'), before)
    } finally {
      rmSync(sdk, { recursive: true, force: true })
    }
  }
})

test('GNU Make stages more than 130 KB of arguments without shell E2BIG', {
  skip: process.platform === 'win32',
}, () => {
  const { sdk, template } = fixture()
  try {
    prepareModdableXslArgsFile({ moddableDirectory: sdk })
    const tmp = path.join(sdk, 'build')
    mkdirSync(tmp)
    writeFileSync(template,
      'TMP_DIR := ' + tmp + '\nMODULES_DIR := ' + tmp +
      '\nMODULES := ' + 'sample.xsb '.repeat(18000) +
      '\n' + readFileSync(template, 'utf8'))
    const binaryDirectory = path.join(sdk, 'bin')
    mkdirSync(binaryDirectory)
    const xsl = path.join(binaryDirectory, 'xsl')
    writeFileSync(xsl, '#!/bin/sh\n[ "$#" = 1 ] && [ "$1" = args.txt ]\n')
    chmodSync(xsl, 0o755)
    const result = spawnSync('make', ['-f', template], {
      cwd: sdk,
      encoding: 'utf8',
      env: { ...process.env, PATH: binaryDirectory + path.delimiter + process.env.PATH },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /Argument list too long|引数リストが長すぎます/)
    const args = readFileSync(path.join(tmp, 'args.txt'), 'utf8')
    assert.ok(args.length > 130000, 'expected long argument file, got ' + args.length)
    assert.match(args, /sample\.xsb/)
  } finally {
    rmSync(sdk, { recursive: true, force: true })
  }
})
