import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
const m=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/app/archive-audio-upload.js',import.meta.url),'utf8'));await m.link(()=>{});await m.evaluate();const accept=m.namespace.acceptAudioChunk;
const upload={buffer:new ArrayBuffer(6),offset:0};
accept(upload,0,new Uint8Array([1,2,3]).buffer);assert.equal(upload.offset,3);
accept(upload,0,new Uint8Array([1,2,3]).buffer);assert.equal(upload.offset,3);
assert.throws(()=>accept(upload,0,new Uint8Array([9,2,3]).buffer));
assert.throws(()=>accept(upload,2,new Uint8Array([3,4]).buffer));
accept(upload,3,new Uint8Array([4,5,6]).buffer);assert.deepEqual(Array.from(new Uint8Array(upload.buffer)),[1,2,3,4,5,6]);
console.log('Audio replay: duplicate ACK recovery, mismatch and overlap rejection passed');
