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

const CAMERA_REQUIRED_FREE = 96 * 1024
const CAMERA_REQUIRED_LARGEST = 32 * 1024

// Camera DMA and temporary JPEG work need contiguous *internal* RAM.
// PSRAM free size alone does not prove the capture can start safely.
export function checkCameraMemory(heap) {
  if (!heap || !Number.isFinite(heap.internalFree) || !Number.isFinite(heap.internalLargest))
    throw new Error('カメラ用の内蔵RAMを確認できません')
  if (heap.internalFree < CAMERA_REQUIRED_FREE || heap.internalLargest < CAMERA_REQUIRED_LARGEST)
    throw new Error('カメラ用の内蔵RAMが不足しています（空き '+heap.internalFree+' / 連続 '+heap.internalLargest+' バイト）')
  return heap
}

// Do not busy-loop or allocate a camera while native audio teardown is pending.
// Timeout is fail-closed; the caller must still release its pause gate in finally.
export async function waitForCameraMemory({
  read,collect=()=>{},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  now=Date.now,timeoutMs=2000,pollMs=100,
}={}) {
  if(typeof read!=='function')throw new Error('カメラ用の内蔵RAMを確認できません')
  const start=now()
  let lastError
  while(true){
    collect()
    try { return checkCameraMemory(read()) }
    catch(e){lastError=e}
    const elapsed=Math.max(0,now()-start)
    if(elapsed>=timeoutMs)throw lastError
    await delay(Math.min(pollMs,timeoutMs-elapsed))
  }
}
