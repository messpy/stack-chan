import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { DROWSY_AFTER_MS, DEEP_SLEEP_AFTER_MS, IdleSleepPolicy } from '../../host/app/archive-idle-policy.js';

test('two stage idle policy: 10 min drowsy, 30 min deep, wake resets both', () => {
  const idle = new IdleSleepPolicy();
  assert.equal(idle.stage, 'awake');
  assert.equal(idle.advance(DROWSY_AFTER_MS - 1000), false);
  assert.equal(idle.stage, 'awake');
  assert.equal(idle.advance(1000), true);
  assert.equal(idle.stage, 'drowsy');
  assert.equal(idle.advance(DEEP_SLEEP_AFTER_MS - DROWSY_AFTER_MS - 1000), false);
  assert.equal(idle.stage, 'drowsy');
  assert.equal(idle.advance(1000), true);
  assert.equal(idle.stage, 'deep');
  assert.equal(idle.advance(86400000), false);
  assert.equal(idle.idleMs, DEEP_SLEEP_AFTER_MS);
  assert.equal(idle.activity(), true);
  assert.equal(idle.stage, 'awake');
  assert.equal(idle.idleMs, 0);
  assert.equal(idle.activity(), false);
  assert.throws(() => idle.advance(-1), RangeError);
});

test('sleep overlays preserve the underlying face and respond to petting and voice', () => {
  class Behavior {}
  class Port {
    constructor(_data, spec) {
      this.spec = spec;
      this.name = spec.name;
      this.time = 0;
      this.drawn = [];
      this.behavior = new spec.Behavior();
      this.behavior.onCreate?.(this);
    }
    fillColor(...args) { this.drawn.push(args); }
    invalidate() {}
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }
  let repeat, timerCleared = false, touchListener, ticks = 0;
  const Time = { get ticks() { return ticks; } };
  const pulse = (delta = 1000) => { ticks = (ticks + delta) >>> 0; repeat(); };
  const timer = {
    repeat(callback, interval) { assert.equal(interval, 1000); repeat = callback; return 1; },
    clear(id) { assert.equal(id, 1); timerCleared = true; },
  };
  const context = vm.createContext({ Port, Timer: timer, Time, IdleSleepPolicy, DEEP_SLEEP_AFTER_MS, Behavior, trace() {} });
  const text = readFileSync(new URL('../../host/app/archive-idle-face.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  vm.runInContext(text + ';globalThis.startIdleFace = startIdleFace;', context);
  const effects = new Set();
  const application = { behavior: { onFaceTouch() {} } };
  const robot = {
    ui: {
      application,
      addEffect(effect) { effects.add(effect); effect.behavior.onDisplaying?.(effect); },
      removeEffect(effect) { effects.delete(effect); effect.behavior.onUndisplaying?.(effect); },
    },
    touchPanel: { subscribe(listener) { touchListener = listener; return () => { touchListener = undefined; }; } },
  };
  const idle = context.startIdleFace(robot, () => true);
  for (let n = 0; n < 600; n++) pulse();
  assert.equal(idle.status().stage, 'drowsy');
  assert.equal(effects.size, 2);
  const [mask, dots] = [...effects];
  mask.behavior.onDraw(mask);
  assert.ok(mask.drawn.some(args => args.join(',') === '#ffffff,23,33,14,4'));
  assert.ok(mask.drawn.some(args => args.join(',') === '#ffffff,163,33,14,4'));
  assert.equal(dots.spec.top, 63, 'Zzz must not obscure top status or captions');
  dots.behavior.onDraw(dots);
  assert.equal(dots.started, undefined);
  // Real 20 minutes can pass during one overdue Timer callback.
  pulse(1200 * 1000);
  assert.equal(idle.status().stage, 'deep');
  assert.equal(idle.status().displayed, 'deep');
  assert.equal(effects.size, 2);
  const [deepMask, marks] = [...effects];
  assert.equal(deepMask, mask, 'eye and mouth geometry must remain identical');
  assert.equal(dots.stopped, true);
  assert.equal(marks.started, true);
  marks.behavior.onDraw(marks);
  const before = JSON.stringify(marks.drawn);
  marks.drawn = [];
  marks.time = 2000;
  marks.behavior.onTimeChanged(marks);
  marks.behavior.onDraw(marks);
  assert.notEqual(JSON.stringify(marks.drawn), before, 'Z marks should move');
  touchListener({ gesture: 'press' });
  assert.equal(idle.status().lastActivityReason, 'head-touch');
  assert.equal(effects.size, 0);
  assert.equal(idle.status().stage, 'awake');
  // Moddable monotonic ticks wrap; crossing 0xffffffff must not lose idle time.
  ticks = 0xffffff00;
  context.stackchanIdleActivity('pre-wrap');
  ticks = 744;
  pulse(0);
  assert.equal(idle.status().idleMs, 1000);
  for (let n = 0; n < 600; n++) pulse();
  context.stackchanIdleActivity('input-transcript');
  assert.equal(idle.status().lastActivityReason, 'input-transcript');
  assert.ok(idle.status().resetCount >= 3);
  assert.equal(effects.size, 0, 'speech activity clears the sleepy face');
  assert.equal(idle.status().idleMs, 0);
  idle.stop();
  assert.equal(timerCleared, true);
  assert.equal(context.stackchanIdleActivity, undefined);
});
