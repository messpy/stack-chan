// Uncompressed formats keep capture independent of sensor JPEG support.
export function bgr24(frame) {
  const {width, height} = frame;
  const stride = (width * 3 + 3) & ~3;
  const out = new Uint8Array(stride * height);
  const src = new DataView(frame.buffer);
  if (frame.imageType !== 'rgb565le' && frame.imageType !== 'rgb565be') throw new Error('Unsupported camera format');
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const v=src.getUint16((y*width+x)*2, frame.imageType==='rgb565le');
    const p=(height-1-y)*stride+x*3;
    out[p]=Math.round((v&31)*255/31);
    out[p+1]=Math.round(((v>>5)&63)*255/63);
    out[p+2]=Math.round(((v>>11)&31)*255/31);
  }
  return out;
}
function text(v,p,s) {for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));}
export function bitmapHeader(w,h) {
  const bytes=((w*3+3)&~3)*h;
  const a=new ArrayBuffer(54),v=new DataView(a);
  text(v,0,'BM');v.setUint32(2,54+bytes,true);v.setUint32(10,54,true);
  v.setUint32(14,40,true);v.setInt32(18,w,true);v.setInt32(22,h,true);
  v.setUint16(26,1,true);v.setUint16(28,24,true);v.setUint32(34,bytes,true);
  return a;
}
export function aviHeader(w,h,fps,count) {
  const bytes=((w*3+3)&~3)*h;
  const a=new ArrayBuffer(224),v=new DataView(a);
  const s=(p,x)=>text(v,p,x),u=(p,x)=>v.setUint32(p,x,true);
  s(0,'RIFF');u(4,216+count*(8+bytes));s(8,'AVI ');
  s(12,'LIST');u(16,192);s(20,'hdrl');s(24,'avih');u(28,56);
  u(32,Math.round(1000000/fps));u(36,(bytes+8)*fps);u(48,count);
  u(56,1);u(60,bytes);u(64,w);u(68,h);
  s(88,'LIST');u(92,116);s(96,'strl');s(100,'strh');u(104,56);
  s(108,'vids');s(112,'DIB ');u(128,1);u(132,fps);u(140,count);
  u(144,bytes);u(148,0xffffffff);v.setUint16(160,w,true);v.setUint16(162,h,true);
  s(164,'strf');u(168,40);u(172,40);u(176,w);u(180,h);
  v.setUint16(184,1,true);v.setUint16(186,24,true);u(192,bytes);
  s(212,'LIST');u(216,4+count*(8+bytes));s(220,'movi');
  return a;
}
export function frameHeader(length) {
  const a=new ArrayBuffer(8),v=new DataView(a);text(v,0,'00db');v.setUint32(4,length,true);return a;
}
export function audioFrameHeader(length) {
  const a=new ArrayBuffer(8),v=new DataView(a);text(v,0,'01wb');v.setUint32(4,length,true);return a;
}
export function aviAudioHeader(w,h,fps,count,audio) {
  const bytes=((w*3+3)&~3)*h, block=audio.channels*(audio.bitsPerSample/8);
  const a=new ArrayBuffer(324),v=new DataView(a);
  new Uint8Array(a).set(new Uint8Array(aviHeader(w,h,fps,count)).subarray(0,212));
  const s=(p,x)=>text(v,p,x),u=(p,x)=>v.setUint32(p,x,true);
  u(4,316+count*(8+bytes)+8+audio.bytes);u(16,292);
  u(36,(bytes+8)*fps+audio.sampleRate*block);u(56,2);
  s(212,'LIST');u(216,92);s(220,'strl');s(224,'strh');u(228,56);
  s(232,'auds');u(252,block);u(256,audio.sampleRate*block);u(264,audio.bytes/block);
  u(268,audio.sampleRate*block);u(272,0xffffffff);u(276,block);
  s(288,'strf');u(292,16);v.setUint16(296,1,true);v.setUint16(298,audio.channels,true);
  u(300,audio.sampleRate);u(304,audio.sampleRate*block);v.setUint16(308,block,true);v.setUint16(310,audio.bitsPerSample,true);
  s(312,'LIST');u(316,4+count*(8+bytes)+8+audio.bytes);s(320,'movi');
  return a;
}
