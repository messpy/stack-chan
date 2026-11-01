import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
const sdk=process.env.MODDABLE?pathToFileURL(process.env.MODDABLE+'/'):new URL('../../../../../stackchan-sdk/moddable/',import.meta.url);
const parent=fs.readFileSync(new URL('modules/network/services/chatAudioIO/workers/googleGeminiLiveModel.js',sdk),'utf8').replace(/^import .*$/gm,'').replace('export default class GoogleGeminiLiveModel','class GoogleGeminiLiveModel');
const adapter=fs.readFileSync(new URL('../../host/app/archive-gemini-worker.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace('new ArchiveGeminiLiveModel({inputSampleRate:16000,outputSampleRate:24000});','globalThis.Model=ArchiveGeminiLiveModel;');
class Transport {
 constructor(){this.messages=[];this.sent=[];this.silence=new ArrayBuffer(4);this.parser={copy(){},done(){}};}
 postMessage(message){this.messages.push(message);}
 post(id){this.postMessage({id});}
 sendJSON(message){this.sent.push(message);}
}
const ctx=vm.createContext({ChatWebSocketWorker:Transport,config:{},installDebugLog(){},trace(){},Object:{freeze:value=>value},ArrayBuffer:class extends ArrayBuffer{static fromString(s){return new TextEncoder().encode(s).buffer;}}});
vm.runInContext(parent+'\n'+adapter,ctx);
const audio={modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000'}}]}};
const count=(m,id)=>m.messages.filter(message=>message.id===id).length;
test('a tool-only answer releases playback and permits the next conversation turn',()=>{
 const m=new ctx.Model({});m.toolCall({functionCalls:[{id:'call-1',name:'conversation_identify',args:{name:'けんと'}}]});
 assert.equal(count(m,'listen'),1);
 m.sendFunctionResult({call:'call-1',name:'conversation_identify',result:{identified:true}});
 m.serverContent({turnComplete:true});
 assert.equal(count(m,'speak'),1,'tool-only completion must release the output side');
 assert.equal(m.speaking,true);
 for(let turn=0;turn<3;turn++){m.serverContent(audio);m.serverContent({outputTranscription:{text:'返答'+turn},turnComplete:true});}
 assert.equal(count(m,'listen'),4);assert.equal(count(m,'speak'),4);assert.equal(m.speaking,true);
});
test('caption-only completion finalizes output without starting fake playback',()=>{
 const m=new ctx.Model({});m.serverContent({outputTranscription:{text:'確認しました'},turnComplete:true});
 const output=m.messages.filter(message=>message.id==='receiveOutputText');
 assert.deepEqual(output.map(message=>[message.text,!!message.more]),[['確認しました',true],['',false]]);
 assert.equal(count(m,'listen'),0);assert.equal(m.speaking,true);
});

test('empty tool notifications do not switch the microphone to playback',()=>{
 const m=new ctx.Model({});m.toolCall({functionCalls:[]});assert.equal(m.speaking,true);assert.equal(count(m,'listen'),0);
});
