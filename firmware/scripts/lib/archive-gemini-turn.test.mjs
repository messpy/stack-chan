import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=fs.readFileSync(new URL('../../host/app/archive-gemini-worker.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace('new ArchiveGeminiLiveModel({inputSampleRate:16000,outputSampleRate:24000});','globalThis.Model=ArchiveGeminiLiveModel;');
const protocol=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-gemini-protocol.js',import.meta.url))).toString('base64'));
class SDK {
 constructor(){this.messages=[];this.speaking=true;}
 postMessage(message){this.messages.push(message);}
 sendJSON(message){this.lastSent=message;}
 serverContent(data){
  if(data.modelTurn?.parts?.some(p=>p.inlineData)&&this.speaking){this.postMessage({id:'receiveInputText',text:''});this.speaking=false;}
  if(data.turnComplete)this.speaking=true;
 }
}
const context=vm.createContext({GoogleGeminiLiveModel:SDK,installDebugLog(){},trace(){},monoPCM:protocol.monoPCM,geminiSetup:protocol.geminiSetup,Uint8Array:class extends Uint8Array{toBase64(){return Buffer.from(this).toString('base64');}}});
vm.runInContext(source,context);
function transcript(model){let pending='',turns=[];for(const m of model.messages){if(m.id!=='receiveInputText')continue;pending+=m.text;if(!m.more&&pending){turns.push(pending);pending='';}}return {pending,turns};}
const audio={modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000'}}]}};
test('text arriving with first audio finishes the current utterance',()=>{const m=new context.Model();m.serverContent({...audio,inputTranscription:{text:'太郎です'}});assert.deepEqual(transcript(m),{pending:'',turns:['太郎です']});});
test('late transcription finishes before the next user utterance',()=>{const m=new context.Model();m.serverContent(audio);m.serverContent({inputTranscription:{text:'こんにちは'}});m.serverContent({turnComplete:true});m.serverContent({inputTranscription:{text:'今何時',finished:true}});assert.deepEqual(transcript(m),{pending:'',turns:['こんにちは','今何時']});});
test('fragmented text and finished marker produce one registration input',()=>{const m=new context.Model();m.serverContent({inputTranscription:{text:'太'}});m.serverContent({inputTranscription:{text:'郎です',finished:true}});m.serverContent(audio);m.serverContent({turnComplete:true});assert.deepEqual(transcript(m),{pending:'',turns:['太郎です']});});

test('microphone packets preserve 16kHz mono samples and stop during playback',()=>{
 const m=new context.Model();m.inputBuffer=new Int16Array([1000,3000,-1000,-3000]).buffer;
 m.sendAudio({offset:0,size:8,channels:2});
 const audio=m.lastSent.realtimeInput.audio;
 assert.equal(audio.mimeType,'audio/pcm;rate=16000');
 const pcm=Buffer.from(audio.data,'base64');assert.equal(pcm.length,4);assert.equal(pcm.readInt16LE(0),2000);assert.equal(pcm.readInt16LE(2),-2000);
 m.speaking=false;m.lastSent=null;m.sendAudio({offset:0,size:8,channels:2});assert.equal(m.lastSent,null);
});
