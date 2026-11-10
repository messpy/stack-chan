// Fixed-schema startup failure event for the existing kmac boot-stages filter.
// No exception messages, stack traces, settings, transcript or arbitrary names.
const CHECKPOINTS = Object.freeze({
  'dock-start': [101, 'dock-context'],
  'platform-input': [102, 'runtime-input'],
  'localization': [103, 'runtime-ui'],
  'timezone': [104, 'runtime-timer'],
  'behavior-resolve': [105, 'default-behavior'],
  'on-launch': [106, 'default-behavior'],
  'miniapp-prepare': [107, 'experimental-miniapps'],
  'network-start': [108, 'runtime'],
  'network-ready': [109, 'runtime'],
  'preferences': [110, 'preferences'],
  'context-create': [111, 'runtime'],
  'dock-context': [112, 'dock-context'],
  'miniapp-register': [113, 'experimental-miniapps'],
  'context-behaviors': [114, 'context-behaviors'],
  'archive-import': [115, 'archive-import'],
  'archive-start': [116, 'archive-start'],
  'finalize': [117, 'runtime'],
});
const PHASES = ['initialization', 'launch', 'network', 'context', 'behavior'];
const ERROR_CLASSES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError'];

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function makeStartupFailureRecord({phase, checkpoint, errorClass, resetReason, heap} = {}) {
  const known = typeof checkpoint === 'string' &&
    Object.prototype.hasOwnProperty.call(CHECKPOINTS, checkpoint);
  const selected = known ? CHECKPOINTS[checkpoint] : [0, 'runtime'];
  return {
    event: 'startup',
    component: selected[1],
    componentState: 'failed',
    phase: PHASES.includes(phase) ? phase : 'unknown',
    error: ERROR_CLASSES.includes(errorClass) ? errorClass : 'unknown',
    reason: 'unclassified',
    site: 'host-main',
    sequence: 0,
    stage: selected[0],
    previousValid: 0,
    previousSequence: 0,
    previousStage: 0,
    previousError: 0,
    resetReason: nonnegativeInteger(resetReason),
    internalFree: nonnegativeInteger(heap?.internalFree),
    internalLargest: nonnegativeInteger(heap?.internalLargest),
    psramFree: nonnegativeInteger(heap?.psramFree),
  };
}
