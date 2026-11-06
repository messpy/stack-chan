import {Port} from 'piu/MC';
import Timer from 'timer';
import Time from 'time';
import {IdleSleepPolicy,DEEP_SLEEP_AFTER_MS} from 'archive-idle-policy';

// Keep the real SimpleFace intact underneath. Only the original 200x120 face
// area is masked; waking removes the overlay without resetting face/emotion.
const FACE_W = 200, FACE_H = 120;
const BLACK = '#000000', WHITE = '#ffffff';

function createSleepMask() {
  return new Port(null, {
    name: 'archive-idle-sleep-face',
    left: 60, top: 60, width: FACE_W, height: FACE_H,
    active: false,
    Behavior: class extends Behavior {
      onDisplaying(port) { port.invalidate(); }
      onDraw(port) {
        port.fillColor(BLACK, 0, 0, FACE_W, FACE_H);
        // The same narrow, straight eye lines in both sleep stages (#6/#8).
        port.fillColor(WHITE, 23, 33, 14, 4);
        port.fillColor(WHITE, 163, 33, 14, 4);
        // Original SimpleFace: closed mouth centered at (100, 88).
        port.fillColor(WHITE, 75, 84, 50, 8);
      }
    }
  });
}

function drawZ(port, x, y, width, thickness) {
  port.fillColor(WHITE, x, y, width, thickness);
  port.fillColor(WHITE, x, y + width - thickness, width, thickness);
  // Rasterize the diagonal from the upper-right to the lower-left.
  for (let row = thickness; row < width - thickness; row += 2)
    port.fillColor(WHITE, x + width - thickness - row, y + row, thickness, 2);
}

function createSleepMarks(stage) {
  return new Port(null, {
    name: 'archive-idle-sleep-marks',
    // Keep decorations below the status bar and subtitles (y=8..32).
    right: 6, top: 63, width: 76, height: 54,
    active: false,
    Behavior: class extends Behavior {
      onCreate(port) { port.interval = 250; }
      onDisplaying(port) { if (stage === 'deep') port.start(); port.invalidate(); }
      onUndisplaying(port) { port.stop(); }
      onTimeChanged(port) { if (stage === 'deep') port.invalidate(); }
      onDraw(port) {
        port.fillColor(BLACK, 0, 0, 76, 54);
        if (stage === 'drowsy') {
          // #6: three quiet dots; eyes stay identical to #8.
          for (const x of [38, 51, 64]) port.fillColor(WHITE, x, 9, 4, 4);
          return;
        }
        // #8: Zzz gently rises and loops every three seconds; 4 FPS only.
        const step = Math.floor(((port.time || 0) % 3000) / 250);
        const rise = Math.floor(step * 10 / 12);
        drawZ(port, 5, 36 - rise, 8, 2);
        drawZ(port, 26, 22 - rise, 12, 2);
        drawZ(port, 51, 10 - rise, 18, 3);
      }
    }
  });
}

export function startIdleFace(robot, canSleep = () => true) {
  const policy = new IdleSleepPolicy();
  let mask, marks, displayed = 'awake', stopped=false;
  let lastTick = Time.ticks >>> 0, lastActivityTick = lastTick;
  let resetCount = 0, lastActivityReason = 'startup';
  const remove = () => {
    if (marks) { robot.ui.removeEffect(marks); marks = undefined; }
    if (mask) { robot.ui.removeEffect(mask); mask = undefined; }
    displayed = 'awake';
  };
  const render = () => {
    const stage = policy.stage;
    if (stage === 'awake' || !canSleep()) { if (displayed !== 'awake') remove(); return; }
    if (stage === displayed) return;
    if (!mask) {
      mask = createSleepMask();
      robot.ui.addEffect(mask, 'archive-idle-sleep-face');
    }
    if (marks) robot.ui.removeEffect(marks);
    marks = createSleepMarks(stage);
    robot.ui.addEffect(marks, 'archive-idle-sleep-marks');
    displayed = stage;
    trace('[idle-face] ' + stage + '\n');
  };
  const activity = (reason = 'user-input') => {
    if(stopped)return;
    policy.activity();
    lastTick = Time.ticks >>> 0;
    lastActivityTick = lastTick;
    lastActivityReason = /^[a-z-]{1,40}$/.test(reason)?reason:'user-input';
    resetCount++;
    if (displayed !== 'awake') remove();
  };
  globalThis.stackchanIdleActivity = activity;
  const unsubscribe = robot.touchPanel?.subscribe(event => {
    if (event.gesture === 'press' || event.gesture === 'forwardSwipe' || event.gesture === 'backwardSwipe')
      activity('head-touch');
  });
  const controller = robot.ui.application?.behavior;
  const previousFaceTouch = controller?.onFaceTouch;
  const faceTouch = function(...args) {
    activity('face-touch');
    return previousFaceTouch?.apply(this, args);
  };
  if (controller) controller.onFaceTouch = faceTouch;
  const tick = Timer.repeat(() => {
    if(stopped)return;
    try {
      // Callback scheduling can lag behind camera/audio/GC. Time.ticks is
      // monotonic and wraps at 2^32; unsigned delta handles the wrap.
      const currentTick = Time.ticks >>> 0;
      const elapsed = (currentTick - lastTick) >>> 0;
      lastTick = currentTick;
      // Busy time is not idle time. Do not reveal an overdue mask after a long TTS/capture.
      if (!canSleep()) {
        policy.activity();lastActivityTick=currentTick;
        if(displayed!=='awake')remove();
        return;
      }
      policy.advance(Math.min(elapsed, DEEP_SLEEP_AFTER_MS));
      render();
    } catch (error) {
      activity('timer-error');
      trace('[idle-face] timer failure; interval reset\n');
    }
  }, 1000);
  const status=()=>({idleMs:policy.idleMs,stage:policy.stage,displayed,resetCount,lastActivityReason});
  globalThis.stackchanIdleStatus=status;
  return {
    activity,
    status: () => ({
      idleMs: policy.idleMs,
      stage: policy.stage,
      displayed,
      canSleep: !!canSleep(),
      faceMode: globalThis.stackchanFaceMode || 'simple',
      customFace: globalThis.stackchanCustomFaceEnabled === true,
      resetCount,
      lastActivityReason,
      sinceLastActivityMs: (Time.ticks - lastActivityTick) >>> 0,
    }),
    stop() {
      if(stopped)return;stopped=true;
      Timer.clear(tick);
      unsubscribe?.();
      if (controller?.onFaceTouch === faceTouch) controller.onFaceTouch = previousFaceTouch;
      if (globalThis.stackchanIdleActivity === activity) globalThis.stackchanIdleActivity = undefined;
      if (globalThis.stackchanIdleStatus === status) globalThis.stackchanIdleStatus = undefined;
      remove();
    }
  };
}
