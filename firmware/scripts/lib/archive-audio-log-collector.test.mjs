import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArchiveAudioLogCollector } from './archive-audio-log-collector.mjs'

test('debug frame fragments reconstruct full audio diagnostics without filtering unknown tags', () => {
  const lines = [], diagnostics = []
  const collector = new ArchiveAudioLogCollector({
    onLine: value => lines.push(value),
    onDiagnostic: value => diagnostics.push(value),
  })
  const frame = fragment => JSON.stringify({ event: 'debug', lines: [fragment],
    status: { dropped: 3, queued: 8 } })
  collector.accept(frame('[audio-path] stage=upload event=heartbeat capturedPcm'))
  collector.accept(frame('Bytes=0 droppedPcmBytes=null encodedPackets=0\n[custom-tag] keep this too\n'))
  const result = collector.end()
  assert.deepEqual(lines, [
    '[audio-path] stage=upload event=heartbeat capturedPcmBytes=0 droppedPcmBytes=null encodedPackets=0',
    '[custom-tag] keep this too',
  ])
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].fields.capturedPcmBytes, '0')
  assert.equal(diagnostics[0].fields.droppedPcmBytes, null)
  assert.equal(diagnostics[0].fields.event, 'heartbeat')
  assert.equal(result.debugFrames, 2)
  assert.equal(result.debugFragments, 2)
  assert.equal(result.lastDebugCounters.dropped, 3)
  assert.equal(result.incompleteDebug, 0)
})

test('malformed JSON and partial final frames are retained and counted', () => {
  const lines = []
  const collector = new ArchiveAudioLogCollector({ onLine: line => lines.push(line) })
  collector.accept('{"event":"debug"')
  collector.accept(JSON.stringify({ event: 'debug', lines: ['[audio-path] stage=decode fragments=0'] }))
  const summary = collector.end()
  assert.equal(summary.malformedFrames, 1)
  assert.equal(summary.incompleteDebug, 1)
  assert.deepEqual(lines, ['{"event":"debug"', '[audio-path] stage=decode fragments=0'])
})

test('diagnostic JSONL emits numeric metadata only, not arbitrary transcript or token', () => {
  const diagnostics = []
  const collector = new ArchiveAudioLogCollector({ onDiagnostic: x => diagnostics.push(x) })
  collector.accept('[audio-path] stage=tts event=sentence_start textChars=12 token=secret transcript=hello')
  collector.accept('[heap] internalFree=0 internalLargest=31744')
  collector.end()
  assert.equal(diagnostics.length, 2)
  assert.deepEqual(diagnostics[0], {
    tag: 'audio-path', fields: { stage: 'tts', event: 'sentence_start', textChars: '12' },
  })
  assert.equal(diagnostics[1].fields.internalFree, '0')
})

test('CLI writes original input bytes and separate reconstructed and analyzed files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stackchan-audio-log-'))
  try {
    const script = fileURLToPath(new URL('./archive-audio-log-collector.mjs', import.meta.url))
    const files = Object.fromEntries(['raw', 'full', 'events', 'summary'].map(name => [name, join(dir, name)]))
    const input = Buffer.from(
      'boot 日本語\r\n' +
      JSON.stringify({ event: 'debug', lines: ['[audio-path] stage=mic capturedBytes=0\n'] }) + '\r\n' +
      'unclassified console message\n',
      'utf8',
    )
    const args = [script, ...Object.entries(files).flatMap(([flag, value]) => ['--' + flag, value])]
    const run = spawnSync(process.execPath, args, { input, encoding: 'utf8', timeout: 15000 })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(readFileSync(files.raw), input)
    assert.match(readFileSync(files.full, 'utf8'), /unclassified console message/)
    assert.match(readFileSync(files.full, 'utf8'), /stage=mic capturedBytes=0/)
    assert.equal(JSON.parse(readFileSync(files.events, 'utf8').trim()).fields.capturedBytes, '0')
    assert.equal(JSON.parse(readFileSync(files.summary, 'utf8')).rawBytes, input.byteLength)
    const overwrite = spawnSync(process.execPath, args, { input, encoding: 'utf8', timeout: 15000 })
    assert.notEqual(overwrite.status, 0, 'Existing raw evidence must not be overwritten')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
