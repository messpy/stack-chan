// Bounded, credential-free diagnostics. Do not retain history on RAM-limited CoreS3.
// PC clients can sample the authenticated LAN endpoint and store data locally.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const tag = (value, limit=40) => typeof value === 'string' && /^[a-z0-9-]+$/.test(value) ? value.slice(0,limit) : 'unknown';

export function heapSummary(heap) {
  const h = heap || {};
  return {
    internalFree: count(h.internalFree),
    internalLargest: count(h.internalLargest),
    internalMinimum: count(h.internalMinimum),
    nativeStackMinimumFree: count(h.nativeStackMinimumFree),
    psramFree: count(h.psramFree),
    psramLargest: count(h.psramLargest),
    psramMinimum: count(h.psramMinimum),
  };
}

export function servoReasonCode(reason) {
  const value = String(reason || '').slice(0,160).toLowerCase();
  if (/timeout|timed out|タイムアウト/.test(value)) return 'timeout';
  if (/checksum|crc|invalid|framing|packet|reply|response/.test(value)) return 'invalid-reply';
  if (/uart|serial|bus|parity/.test(value)) return 'bus-error';
  if (/power|voltage|電源/.test(value)) return 'power-error';
  if (/unavailable|missing|not found|not initialized/.test(value)) return 'unavailable';
  return 'unknown';
}

export function memoryReasonCode(detail) {
  const value = String(detail || '').slice(0,220);
  if (/内蔵RAM|memory|allocat|opus encoder/i.test(value)) return 'memory-pressure';
  if (/\b401\b|\b403\b|unauthori[sz]ed|authentication/i.test(value)) return 'authentication';
  if (/timeout|network|dns|websocket|socket|connect/i.test(value)) return 'network';
  return value ? 'other' : 'none';
}

export function markHeap(stage, heap, emit) {
  const summary = heapSummary(heap);
  if (typeof emit === 'function') {
    // Only numeric counts and a validated static stage; never keys, IPs or dialogue.
    try {
      emit('[diag-heap] stage=' + tag(stage) +
        ' free=' + summary.internalFree +
        ' largest=' + summary.internalLargest +
        ' minimum=' + summary.internalMinimum +
        ' psramFree=' + summary.psramFree + '\n');
    } catch (_) {}
  }
  return summary;
}

export function diagnosticSnapshot({heap, chat, photo, debug, now}) {
  const c = chat || {}, p = photo || {}, d = debug || {};
  return {
    schema: 1,
    at: Number.isSafeInteger(now) && now > 0 ? now : null,
    heap: heapSummary(heap),
    chat: {
      state: tag(c.state), provider: tag(c.provider),
      enabled: c.enabled === true, recognitionMode: c.recognitionMode === true,
      failureClass: memoryReasonCode(c.detail),
    },
    photo: {
      phase: tag(p.phase), saved: p.saved === true,
      errorStage: p.errorStage == null ? null : tag(p.errorStage),
      active: p.active === true,
    },
    debug: {
      queued: count(d.queued), dropped: count(d.dropped),
      truncated: count(d.truncated), usbRetries: count(d.usbRetries),
    },
  };
}
