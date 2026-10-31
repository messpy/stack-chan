// Replayed chunks are accepted only if their bytes match the staged audio.
export function acceptAudioChunk(upload,offset,bytes){
  if(!upload||!Number.isSafeInteger(offset)||offset<0||offset>upload.offset||bytes.byteLength>8192||offset+bytes.byteLength>upload.buffer.byteLength)throw new Error('Invalid audio offset');
  const destination=new Uint8Array(upload.buffer),source=new Uint8Array(bytes);
  if(offset<upload.offset){
    if(offset+source.length>upload.offset)throw new Error('Overlapping audio chunk');
    for(let i=0;i<source.length;i++)if(destination[offset+i]!==source[i])throw new Error('Mismatched replayed audio chunk');
  }else{destination.set(source,offset);upload.offset+=source.length;}
  upload.time=Date.now();
  return {offset:upload.offset};
}
