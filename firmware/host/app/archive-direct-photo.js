// Consolidated explicit camera commands from PR #47/#55, scoped to the
// current ASR utterance. Never infer permission from a historical mention,
// a question, or an LLM-proposed action. Photos do not imply cloud upload.
export function directPhotoRequest(text) {
  const source = String(text ?? '').trim();
  if (!source || source.length > 80) return false;
  const normalized = source.replace(/[\s、。，,.!！?？]/gu, '');
  return /^(?:(?:ねえ|ねぇ|スタックちゃん|スタックチャン|マックちゃん|マックチャン))?(?:(?:カメラで)?写真(?:を)?(?:(?:1|一)枚)?(?:撮って|とって|撮影して)|(?:カメラ)(?:を|で)?(?:撮って|とって|撮影して)|撮影して)(?:ください|お願い|ね|よ)?$/u.test(normalized);
}
