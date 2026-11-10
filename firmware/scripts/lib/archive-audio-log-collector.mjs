import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TextDecoder } from 'node:util'

const MAX_PENDING_DEBUG = 65536
const DIAGNOSTIC_TAGS = new Set(['audio-path', 'heap', 'opus', 'playback', 'startup'])
const TAG = /^\[([a-z][a-z0-9-]*)\]/

// Keep unfiltered raw bytes and a reconstructed, unfiltered text stream separately.
// JSONL is a sanitized numeric subset suitable for analysis, NOT a replacement for raw.
export class ArchiveAudioLogCollector {
  constructor({ onLine = () => {}, onDiagnostic = () => {} } = {}) {
    this.onLine = onLine
    this.onDiagnostic = onDiagnostic
    this.pendingDebug = ''
    this.stats = {
      rawLines: 0, debugFrames: 0, debugFragments: 0, reconstructedLines: 0,
      diagnosticEvents: 0, malformedFrames: 0, overflowedFragments: 0,
      incompleteDebug: 0, lastDebugCounters: {},
    }
  }

  accept(line) {
    this.stats.rawLines++
    const trimmed = line.trim()
    if (trimmed.startsWith('{')) {
      try {
        const frame = JSON.parse(trimmed)
        if (frame?.event === 'debug' && Array.isArray(frame.lines)) {
          this.stats.debugFrames++
          this.stats.debugFragments += frame.lines.length
          this.updateCounters(frame.status)
          for (const fragment of frame.lines) {
            if (typeof fragment === 'string') this.acceptFragment(fragment)
          }
          return
        }
      } catch (_) {
        this.stats.malformedFrames++
        // Do not discard malformed frames: the raw and reconstructed streams
        // retain them for inspection.
      }
    }
    this.emitLine(line)
  }

  updateCounters(status) {
    if (!status || typeof status !== 'object') return
    for (const [key, value] of Object.entries(status)) {
      if (/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key) &&
          typeof value === 'number' && Number.isFinite(value)) {
        this.stats.lastDebugCounters[key] = value
      }
    }
  }

  acceptFragment(fragment) {
    this.pendingDebug += fragment
    if (this.pendingDebug.length > MAX_PENDING_DEBUG) {
      this.stats.overflowedFragments++
      this.emitLine(this.pendingDebug)
      this.pendingDebug = ''
      return
    }
    let index
    while ((index = this.pendingDebug.indexOf('\n')) >= 0) {
      const line = this.pendingDebug.slice(0, index).replace(/\r$/, '')
      this.pendingDebug = this.pendingDebug.slice(index + 1)
      this.emitLine(line)
    }
  }

  emitLine(line) {
    this.stats.reconstructedLines++
    this.onLine(line)
    const match = TAG.exec(line)
    if (!match || !DIAGNOSTIC_TAGS.has(match[1])) return
    const fields = {}
    for (const token of line.slice(match[0].length).trim().split(/\s+/)) {
      const separator = token.indexOf('=')
      if (separator < 1) continue
      const key = token.slice(0, separator)
      const value = token.slice(separator + 1)
      if (!/^[A-Za-z][A-Za-z0-9_]{0,45}$/.test(key)) continue
      if (/^-?\d+(?:\.\d+)?(?:B|ms|us|%)?$/.test(value) || value === 'null') {
        fields[key] = value === 'null' ? null : value
      } else if (['stage', 'event', 'kind', 'mode'].includes(key) &&
          /^[a-z][a-z0-9_-]{0,40}$/.test(value)) {
        fields[key] = value
      }
    }
    this.stats.diagnosticEvents++
    this.onDiagnostic({ tag: match[1], fields })
  }

  end() {
    if (this.pendingDebug) {
      this.stats.incompleteDebug++
      this.emitLine(this.pendingDebug)
      this.pendingDebug = ''
    }
    return { ...this.stats, lastDebugCounters: { ...this.stats.lastDebugCounters } }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const flags = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1]) throw Error('Expected --raw --full --events --summary paths')
    flags[args[i].slice(2)] = resolve(args[i + 1])
  }
  if (!['raw', 'full', 'events', 'summary'].every(key => flags[key]) ||
      new Set(Object.values(flags)).size !== 4) {
    throw Error('All four output paths must exist as arguments and be distinct')
  }
  for (const path of Object.values(flags)) mkdirSync(dirname(path), { recursive: true })
  const raw = createWriteStream(flags.raw, { flags: 'wx' })
  const full = createWriteStream(flags.full, { flags: 'wx' })
  const events = createWriteStream(flags.events, { flags: 'wx' })
  const collector = new ArchiveAudioLogCollector({
    onLine: line => full.write(line + '\n'),
    onDiagnostic: item => events.write(JSON.stringify(item) + '\n'),
  })
  const decoder = new TextDecoder()
  let pending = ''
  let rawBytes = 0
  for await (const chunk of process.stdin) {
    raw.write(chunk) // byte-for-byte; no regex filters or lost unknown events
    rawBytes += chunk.byteLength
    pending += decoder.decode(chunk, { stream: true })
    let index
    while ((index = pending.indexOf('\n')) >= 0) {
      collector.accept(pending.slice(0, index).replace(/\r$/, ''))
      pending = pending.slice(index + 1)
    }
    if (pending.length > 1048576) {
      collector.stats.overflowedFragments++
      collector.accept(pending)
      pending = ''
    }
  }
  pending += decoder.decode()
  if (pending) collector.accept(pending)
  const summary = { ...collector.end(), rawBytes }
  raw.end(); full.end(); events.end()
  await Promise.all([once(raw, 'finish'), once(full, 'finish'), once(events, 'finish')])
  writeFileSync(flags.summary, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' })
  process.stderr.write('[INFO] Raw bytes=' + rawBytes +
    ' extractedLines=' + summary.reconstructedLines +
    ' diagnosticEvents=' + summary.diagnosticEvents +
    ' malformedFrames=' + summary.malformedFrames + '\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    process.stderr.write('[FATAL] STEP=AUDIO_LOG_COLLECT reason=' + String(error?.message ?? error) + '\n')
    process.exitCode = 1
  })
}
