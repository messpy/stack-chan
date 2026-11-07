// PSRAM cannot replace internal RAM needed by DMA, TLS and native task stacks.
export function isMemoryPressure(reason) {
  return /memory|内蔵RAM|allocation|Opus encoder initialization/i.test(String(reason||''))
}
export function shouldRenewCloudIdentity(reason) {
  return /(?:\b401\b|\b403\b|unauthori[sz]ed|authentication failed|token.*(?:expired|invalid))/i.test(String(reason||''))
}
export function checkVoiceMemory(heap, usesOpus = true) {
  if (!heap || !Number.isFinite(heap.internalFree) || !Number.isFinite(heap.internalLargest)) return
  // Includes both task stacks, TLS, DMA and a reserve for SD/settings operations.
  const required = (usesOpus ? 112 : 80) * 1024
  if (heap.internalFree < required || heap.internalLargest < 24 * 1024)
    throw new Error('内蔵RAMの空きが不足しています（空き '+heap.internalFree+' / 連続 '+heap.internalLargest+' バイト）。音声を停止して回復を待っています')
}

export function checkCameraMemory(heap) {
  // Conservative guard for CoreS3 sensor init, DMA buffers and JPEG conversion.
  // Re-check only after closing the voice Opus/TLS session and collecting garbage.
  const free=heap?.internalFree,largest=heap?.internalLargest;
  if(!Number.isFinite(free)||!Number.isFinite(largest))
    throw new Error('カメラの内蔵RAM状態を確認できません');
  if(free<96*1024||largest<32*1024)
    throw new Error('カメラ用の内蔵RAMが不足しています（空き '+free+' / 連続 '+largest+' バイト）。音声解放後も不足しているため撮影を中止します');
}
