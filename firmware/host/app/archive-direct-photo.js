// Explicit stand-alone camera commands. No LLM decision or image upload.
export function directPhotoRequest(text) {
  const source = String(text ?? '').trim().replace(/[。.!！?？]+$/u, '').trim();
  if (source.length > 80) return false;
  return /^(?:(?:スタックちゃん|スタックチャン)[、,\s]*)?(?:カメラで)?写真(?:を)?(?:(?:1|一)枚)?(?:撮って|とって|撮影して)(?:ください)?$/u.test(source);
}
