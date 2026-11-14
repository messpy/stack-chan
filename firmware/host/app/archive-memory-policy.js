// PSRAM cannot replace internal RAM needed by DMA, TLS and native task stacks.
export function isMemoryPressure(reason) {
  return /memory|内蔵RAM|allocation|Opus encoder initialization/i.test(String(reason||''))
}
export function shouldRenewCloudIdentity(reason) {
  return /(?:\b401\b|\b403\b|unauthori[sz]ed|authentication failed|token.*(?:expired|invalid))/i.test(String(reason||''))
}

// Report the exact pre-connect admission decision; thresholds are intentionally unchanged.
// This result contains counters only, never session credentials or transcripts.
export function voiceMemoryAdmission(heap, usesOpus = true) {
  // Includes task stacks, TLS, DMA and reserves for SD/settings operations.
  const requiredFree = (usesOpus ? 112 : 80) * 1024
  const requiredLargest = 24 * 1024
  if (!heap || !Number.isFinite(heap.internalFree) || !Number.isFinite(heap.internalLargest))
    return {status:'unmeasured',internalFree:null,internalLargest:null,requiredFree,requiredLargest,shortfallFree:null,shortfallLargest:null}
  const internalFree = heap.internalFree
  const internalLargest = heap.internalLargest
  const shortfallFree = Math.max(0,requiredFree-internalFree)
  const shortfallLargest = Math.max(0,requiredLargest-internalLargest)
  return {
    status: shortfallFree>0 || shortfallLargest>0 ? 'blocked' : 'pass',
    internalFree,internalLargest,requiredFree,requiredLargest,
    shortfallFree,shortfallLargest,
  }
}

export function checkVoiceMemory(heap, usesOpus = true) {
  const result = voiceMemoryAdmission(heap, usesOpus)
  if (result.status === 'blocked')
    throw new Error('内蔵RAMの空きが不足しています（空き '+result.internalFree+' / 連続 '+result.internalLargest+' バイト）。音声を停止して回復を待っています')
}
