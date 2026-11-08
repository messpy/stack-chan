import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Issue #35: user-visible conversation subtitles belong below the face.
// This guards against older PR #15/#25 silently restoring top:8 captions.
// It is a source contract, NOT a substitute for CoreS3 LCD geometry testing.
const firmware = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const source = (name) => readFileSync(resolve(firmware, 'host/app', name), 'utf8')

function explicitBalloonOptions(text) {
  return [...text.matchAll(/robot\.showBalloon\([^;\n]*\{[^}\n]*\}\)/g)].map(([value]) => value)
}

test('chat captions keep explicit bottom positioning, not top positioning', () => {
  const balloons = explicitBalloonOptions(source('archive-direct-chat.js'))
  const conversationCaptions = balloons.filter((call) => /(?:holdMs|height:24|paddingY:4)/.test(call))
  assert.ok(conversationCaptions.length >= 7, 'expected existing conversation caption call sites')
  for (const call of conversationCaptions) {
    assert.match(call, /\bbottom\s*:/, 'conversation caption lost bottom placement')
    assert.doesNotMatch(call, /\btop\s*:/, 'top-positioned caption conflicts with #35')
  }
})

test('offline speech subtitles stay on the bottom edge', () => {
  const code = source('archive-offline.js')
  assert.match(code, /bottom:\s*options\.bottom\s*\?\?\s*\(faceButtons\s*\?\s*50\s*:\s*12\)/)
  assert.doesNotMatch(code, /showChatCaption\s*\(/, 'shared top caption helper must not override offline bottom layout')
})

// Regression purpose is to flag incompatible changes while the lower safe-area
// placement and speaker-strip overlap are still being redesigned and tested.
