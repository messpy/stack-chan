import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Load the real Moddable helper without requiring the device runtime.
const source = readFileSync(new URL('../../host/app/archive-chat-caption.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.replace(/^export /gm, '') + '\n;globalThis.caption = { CHAT_CAPTION_LAYOUT, showChatCaption };', context);
const { CHAT_CAPTION_LAYOUT, showChatCaption } = context.caption;

test('conversation captions stay above the face and speaker controls', () => {
  assert.equal(CHAT_CAPTION_LAYOUT.top, 8);
  assert.equal(CHAT_CAPTION_LAYOUT.height, 24);
  assert.equal(CHAT_CAPTION_LAYOUT.paddingY, 4);
  assert.equal(CHAT_CAPTION_LAYOUT.bottom, undefined);
  // SimpleFace occupies y=60..180 (mouth moves up to 6 pixels for breathing).
  assert.ok(CHAT_CAPTION_LAYOUT.top + CHAT_CAPTION_LAYOUT.height < 60);
  // The compact and expanded speaker strips extend upwards from the bottom.
  assert.ok(CHAT_CAPTION_LAYOUT.top + CHAT_CAPTION_LAYOUT.height < 240 - 4 - 76);
});

test('every caption uses the same layout while preserving duration and content', () => {
  const calls = [];
  const robot = { showBalloon(text, options) { calls.push({ text, options }); } };
  showChatCaption(robot, '聞き取り中', 15000);
  showChatCaption(robot, '返答します', 60000);
  showChatCaption(robot, 'オフラインです');
  assert.deepEqual(calls.map(({ text }) => text), ['聞き取り中', '返答します', 'オフラインです']);
  assert.deepEqual(calls.map(({ options }) => options.holdMs), [15000, 60000, 5000]);
  for (const { options } of calls) {
    assert.equal(options.top, CHAT_CAPTION_LAYOUT.top);
    assert.equal(options.height, CHAT_CAPTION_LAYOUT.height);
    assert.equal(options.paddingY, CHAT_CAPTION_LAYOUT.paddingY);
    assert.equal(options.bottom, undefined);
  }
});
