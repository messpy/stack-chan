import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=fs.readFileSync(new URL('../../host/app/archive-gemini-worker.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace('new ArchiveGeminiLiveModel({inputSampleRate:16000,outputSampleRate:24000});','globalThis.Model=ArchiveGeminiLiveModel;');
class SDK {
 constructor(){this.messages=[];this.speaking=true;}
 postMessage(message){this.messages.push(message);}
 serverContent(data){
  if(data.modelTurn?.parts?.some(p=>p.inlineData)&&this.speaking){this.postMessage({id:'receiveInputText',text:''});this.speaking=false;}
  if(data.turnComplete)this.speaking=true;
 }
}
const context=vm.createContext({GoogleGeminiLiveModel:SDK,installDebugLog(){},trace(){}});
vm.runInContext(source,context);
function transcript(model){let pending='',turns=[];for(const m of model.messages){if(m.id!=='receiveInputText')continue;pending+=m.text;if(!m.more&&pending){turns.push(pending);pending='';}}return {pending,turns};}
const audio={modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000'}}]}};
test('text arriving with first audio finishes the current utterance',()=>{const m=new context.Model();m.serverContent({...audio,inputTranscription:{text:'太郎です'}});assert.deepEqual(transcript(m),{pending:'',turns:['太郎です']});});
test('late transcription finishes before the next user utterance',()=>{const m=new context.Model();m.serverContent(audio);m.serverContent({inputTranscription:{text:'こんにちは'}});m.serverContent({turnComplete:true});m.serverContent({inputTranscription:{text:'今何時',finished:true}});assert.deepEqual(transcript(m),{pending:'',turns:['こんにちは','今何時']});});
test('fragmented text and finished marker produce one registration input',()=>{const m=new context.Model();m.serverContent({inputTranscription:{text:'太'}});m.serverContent({inputTranscription:{text:'郎です',finished:true}});m.serverContent(audio);m.serverContent({turnComplete:true});assert.deepEqual(transcript(m),{pending:'',turns:['太郎です']});});
