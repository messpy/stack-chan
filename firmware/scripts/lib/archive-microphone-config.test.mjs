import fs from 'node:fs';
import assert from 'node:assert/strict';
const manifest=JSON.parse(fs.readFileSync(new URL('../../host/app/manifest_archive.example.json',import.meta.url),'utf8'));
const board=JSON.parse(fs.readFileSync(new URL('../../host/platforms/m5stackchan_cores3/manifest.json',import.meta.url),'utf8'));
// SDK ChatAudioIO includes a mono default. This app must override it to match
// CoreS3 hardware, because the ESP32 audio-in driver extracts mono from stereo.
assert.equal(manifest.defines.audioIn.numChannels,board.defines.audioIn.numChannels);
assert.equal(manifest.defines.audioIn.sampleRate,16000);
console.log('PASS: archive microphone format matches CoreS3 stereo capture and 16kHz wire conversion');
