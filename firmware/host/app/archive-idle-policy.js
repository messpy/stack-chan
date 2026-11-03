// Monotonic idle time: independent of RTC/SNTP jumps and safe across tick wrap.
export const DROWSY_AFTER_MS = 10 * 60 * 1000;
export const DEEP_SLEEP_AFTER_MS = 30 * 60 * 1000;

export class IdleSleepPolicy {
  constructor() {
    this.idleMs = 0;
    this.stage = 'awake';
  }

  advance(milliseconds = 1000) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0)
      throw new RangeError('Invalid idle interval');
    this.idleMs = Math.min(DEEP_SLEEP_AFTER_MS, this.idleMs + milliseconds);
    const next = this.idleMs >= DEEP_SLEEP_AFTER_MS
      ? 'deep' : this.idleMs >= DROWSY_AFTER_MS ? 'drowsy' : 'awake';
    const changed = next !== this.stage;
    this.stage = next;
    return changed;
  }

  activity() {
    const changed = this.stage !== 'awake';
    this.idleMs = 0;
    this.stage = 'awake';
    return changed;
  }
}
