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
  // CoreS3 still-photo admission: free SRAM for DMA, TLS teardown and JPEG.
  // The prior 32 KiB contiguous gate rejected real hardware at 31,744 B,
  // *before* trying the camera; 176x144 capture previously succeeded there.
  // Use 30 KiB only with >=96 KiB free SRAM and >=1 MiB free PSRAM.
  // CoreS3's SDK camera uses two PSRAM frame buffers after the build patch.
  // These are preflight limits, NOT proof the driver can allocate: retain
  // native error propagation and the independent 60-second photo watchdog.
  const free=heap?.internalFree,largest=heap?.internalLargest,psram=heap?.psramFree;
  if(!Number.isFinite(free)||!Number.isFinite(largest)||!Number.isFinite(psram))
    throw new Error('カメラの内蔵RAM/PSRAM状態を確認できません');
  if(free<96*1024||largest<30*1024||psram<1024*1024)
    throw new Error('カメラ用の内蔵RAM/PSRAMが不足しています（内部 '+free+' / 連続 '+largest+' / PSRAM '+psram+' バイト）。音声解放後も不足しているため撮影を中止します');
}

export async function waitForCameraMemory({read,collect,delay,now=Date.now,timeoutMs=1500,pollMs=150}) {
  // No sensor allocation is attempted until internal SRAM is demonstrably usable.
  const deadline=now()+timeoutMs;
  let lastError;
  while(true){
    try{collect?.();}catch(_){}
    try{
      const heap=read();
      checkCameraMemory(heap);
      return heap;
    }catch(error){lastError=error;}
    if(now()>=deadline)throw lastError;
    await delay(pollMs);
  }
}
