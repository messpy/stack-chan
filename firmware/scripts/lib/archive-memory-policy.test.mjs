import fs from 'node:fs';
import assert from 'node:assert/strict';
const policy=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-memory-policy.js',import.meta.url))).toString('base64'));
policy.checkVoiceMemory({internalFree:160*1024,internalLargest:40*1024});
for(const heap of [{internalFree:5000,internalLargest:3000},{internalFree:160*1024,internalLargest:3000}])assert.throws(()=>policy.checkVoiceMemory(heap),/内蔵RAM/);
assert.equal(policy.isMemoryPressure('ESP Opus encoder initialization failed'),true);
assert.equal(policy.shouldRenewCloudIdentity('ESP Opus encoder initialization failed'),false);
assert.equal(policy.shouldRenewCloudIdentity('Network connection closed'),false);
assert.equal(policy.shouldRenewCloudIdentity('HTTP 401 unauthorized'),true);
assert.equal(policy.shouldRenewCloudIdentity('token expired'),true);

// Last-attempt admission is independent of the active session's live free RAM.
const failed=policy.voiceMemoryAdmission({internalFree:76659,internalLargest:31744});
assert.equal(failed.status,'blocked');
assert.equal(failed.shortfallFree,38029);
assert.equal(failed.shortfallLargest,0);
assert.equal(failed.requiredFree,112*1024);
assert.equal(failed.requiredLargest,24*1024);
const passed=policy.voiceMemoryAdmission({internalFree:119803,internalLargest:31744});
assert.equal(passed.status,'pass');
assert.equal(passed.shortfallFree,0);
assert.equal(policy.voiceMemoryAdmission({internalFree:120000,internalLargest:20000}).status,'blocked');
assert.equal(policy.voiceMemoryAdmission({internalFree:5000}).status,'unmeasured');
assert.equal(policy.voiceMemoryAdmission({internalFree:80*1024,internalLargest:24*1024},false).status,'pass');
// Never silently lower the admission threshold.
assert.throws(()=>policy.checkVoiceMemory({internalFree:112*1024-1,internalLargest:24*1024}),/内蔵RAM/);
console.log('PASS: insufficient or fragmented internal RAM blocks audio; resource/network failures never trigger identity renewal');
