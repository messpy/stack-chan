let upload;
export function jpegDimensions(buffer){
 const a=new Uint8Array(buffer);if(a.length<10||a[0]!==255||a[1]!==216||a[a.length-2]!==255||a[a.length-1]!==217)throw new Error('JPEG画像を選んでください');
 let at=2;while(at+4<a.length){if(a[at++]!==255)throw new Error('Invalid JPEG');while(a[at]===255)at++;const marker=a[at++];if(marker===218||marker===217)break;const n=(a[at]<<8)|a[at+1];if(n<2||at+n>a.length)break;if([192,193,194].includes(marker)){const h=(a[at+3]<<8)|a[at+4],w=(a[at+5]<<8)|a[at+6];if(n<8||!w||!h||w>1024||h>1024)throw new Error('画像を1024px以下にしてください');return {width:w,height:h};}at+=n;}
 throw new Error('JPEGのサイズを確認できませんでした');
}
export function imageUploadCommand(op,args,decode){
 if(upload&&Date.now()-upload.time>120000)upload=undefined;
 if(op==='begin'){if(upload)throw new Error('別の画像を転送中です');if(!Number.isSafeInteger(args.size)||args.size<10||args.size>262144)throw new Error('画像は256KB以下にしてください');upload={id:Date.now().toString(36),buffer:new ArrayBuffer(args.size),offset:0,time:Date.now()};return {id:upload.id,offset:0};}
 if(!upload||args.id!==upload.id)throw new Error('画像転送が見つかりません');
 if(op==='cancel'){upload=undefined;return {cancelled:true};}
 if(op==='chunk'){const b=new Uint8Array(decode(args.data)),offset=args.offset;if(!Number.isSafeInteger(offset)||offset<0||offset>upload.offset||b.length>1500||!b.length||offset+b.length>upload.buffer.byteLength)throw new Error('Invalid image chunk');const target=new Uint8Array(upload.buffer);if(offset<upload.offset){if(offset+b.length>upload.offset)throw new Error('Overlapping image chunk');for(let i=0;i<b.length;i++)if(target[offset+i]!==b[i])throw new Error('Mismatched image chunk');}else{target.set(b,offset);upload.offset+=b.length;}upload.time=Date.now();return {offset:upload.offset};}
 if(op==='finish'){if(upload.offset!==upload.buffer.byteLength)throw new Error('画像の転送が途中です');const result={buffer:upload.buffer,...jpegDimensions(upload.buffer)};upload=undefined;return result;}
 throw new Error('Unknown image operation');
}
