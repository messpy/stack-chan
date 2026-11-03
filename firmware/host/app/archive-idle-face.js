import {Port} from 'piu/MC';
import Timer from 'timer';
import {IdleSleepPolicy} from 'archive-idle-policy';

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
      onDraw(port) {
        port.fillColor(BLACK, 0, 0, FACE_W, FACE_H);
        // The same narrow, straight eye lines in both sleep stages (#6/#8).
        port.fillColor(WHITE, 23, 31, 14, 4);
        port.fillColor(WHITE, 163, 34, 14, 4);
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
    right: 12, top: 8, width: 76, height: 54,
    active: false,
    Behavior: class extends Behavior {
      onCreate(port) { port.interval = 250; },
      onDisplaying(port) { if (stage === 'deep') port.start(); port.invalidate(); },
      onUndisplaying(port) { port.stop(); },
      onTimeChanged(port) { if (stage === 'deep') port.invalidate(); },
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
  let mask, marks, displayed = 'awake';
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
  const activity = () => {
    policy.activity();
    if (displayed !== 'awake') remove();
  };
  globalThis.stackchanIdleActivity = activity;
  const unsubscribe = robot.touchPanel?.subscribe(event => {
    if (event.gesture === 'press' || event.gesture === 'forwardSwipe' || event.gesture === 'backwardSwipe')
      activity();
  });
  const controller = robot.ui.application?.behavior;
  const previousFaceTouch = controller?.onFaceTouch;
  const faceTouch = function(...args) {
    activity();
    return previousFaceTouch?.apply(this, args);
  };
  if (controller) controller.onFaceTouch = faceTouch;
  const tick = Timer.repeat(() => {
    try { policy.advance(1000); render(); }
    catch (error) {
      activity();
      trace('[idle-face] disabled this idle interval: ' + String(error) + '\n');
    }
  }, 1000);
  return {
    activity,
    status: () => ({idleMs: policy.idleMs, stage: policy.stage}),
    stop() {
      Timer.clear(tick);
      unsubscribe?.();
      if (controller?.onFaceTouch === faceTouch) controller.onFaceTouch = previousFaceTouch;
      if (globalThis.stackchanIdleActivity === activity) globalThis.stackchanIdleActivity = undefined;
      remove();
    }
  };
}
