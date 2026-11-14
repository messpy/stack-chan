import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const events=[],sent=[];
class Base{post(id){events.push({id})}postMessage(message){events.push(message)}sendJSON(event){sent.push(event)}read(){throw Error('unexpected audio parser')}}
const ctx=vm.createContext({trace(){},URL,Uint8Array,ArrayBuffer,JSON});
const dependencies={stackchanOpusDecoder:{default:class{constructor(rate,duration){this.outputBytes=rate*duration/1000*2}close(){}}},stackchanOpusEncoder:{default:class{constructor(){this.outputBytes=1275}attachPcmRing(){}clear(){}close(){}}},stackchanServerChatWebSocketWorker:{default:Base},timer:{default:{clear(){},repeat(){return 1}}},'xiaozhi-contract':{parseJsonRpcMessage:x=>x,parseXiaozhiV1ClientEvent:x=>x,parseXiaozhiV1ServerEvent:x=>x,sanitizeXiaozhiV1HelloExtension:()=>({})}};
const module=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/modules/conversation/chat-audioio/xiaozhi-model.js',import.meta.url),'utf8'),{context:ctx});await module.link(name=>{const values=dependencies[name];return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context:ctx})});await module.evaluate();
const model=new module.namespace.default();model.configure({recognitionOnly:true,configuration:{protocol:'xiaozhi-v1',endpoint:'wss://api.tenclass.net/test',identity:{deviceId:'device',clientId:'client'},authentication:{bearerToken:'test'}}});assert.equal(model.configurationError,'');
model.pcmRing=new SharedArrayBuffer(64);model.pcmRingState=new SharedArrayBuffer(16);model.hello({audio_params:{sample_rate:24000,frame_duration:60}});
model.stt({text:'一分のタイマーをセットして'});assert.equal(events.at(-1).id,'receiveInputText');assert.equal(events.at(-1).text,'一分のタイマーをセットして');assert.ok(sent.some(e=>e.type==='abort'));assert.equal(sent.at(-1).state,'start');assert.equal(model.uploading,true);
const count=events.length;model.decoder={decode(){throw Error('must not decode XiaoZhi reply')}};
model.tts({state:'start'});model.tts({state:'sentence_start',text:'server answer'});model.tts({state:'stop'});model.llm({text:'server answer'});model.mcp({payload:{method:'tools/call'}});model.read(new ArrayBuffer(10),{binary:true});assert.equal(events.slice(count).filter(e=>e.id!=='uploadState').length,0,'no cloud reply, control call or audio reaches the device');assert.equal(model.uploading,true,'late TTS start must resume recognition upload');
model.recognitionOnly=false;model.stt({text:'通常会話'});assert.equal(events.at(-1).text,'通常会話');
console.log('PASS: recognition text forwarded, server response aborted, audio/text/tool replies suppressed, ordinary STT preserved');

model.decoder=undefined;model.configure({recognitionOnly:false,pcmRing:new SharedArrayBuffer(64),pcmRingState:new SharedArrayBuffer(16),configuration:{protocol:'xiaozhi-v1',endpoint:'wss://api.tenclass.net/test',identity:{deviceId:'device',clientId:'client'}}});
model.hello({audio_params:{sample_rate:24000,frame_duration:60}});
const voiceBytes=24000*2*0.06*3,staged=new Uint8Array(voiceBytes+model.silence.byteLength);staged.fill(7,0,voiceBytes);staged.set(new Uint8Array(model.silence),voiceBytes);
// A driver emits only whole DMA blocks. All voice samples must be included.
const transmitted=Math.floor(staged.length/4092)*4092;
assert.ok(transmitted>=voiceBytes);assert.ok(staged.slice(0,voiceBytes).every(v=>v===7));
console.log('PASS: XiaoZhi trailing silence flushes the partial DMA block without clipping final voice samples');

model.configure({recognitionOnly:false,pcmRing:new SharedArrayBuffer(64),pcmRingState:new SharedArrayBuffer(16),configuration:{protocol:'xiaozhi-v1',endpoint:'wss://api.tenclass.net/test',identity:{deviceId:'device',clientId:'client'}}});
model.hello({audio_params:{sample_rate:24000,frame_duration:60}});
let before=events.length;
model.tts({state:'start'});model.tts({state:'sentence_start',text:'おやすみなさい'});model.tts({state:'stop'});
assert.equal(events.slice(before).filter(e=>e.id!=='uploadState').length,0,'idle cloud speech must not reach playback or subtitles');
assert.equal(model.uploading,true,'idle suppression resumes listening');
assert.ok(sent.some(e=>e.type==='abort'&&e.reason==='unsolicited_speech'));
model.stt({text:'こんにちは'});model.tts({state:'start'});
assert.equal(model.suppressReply,false);assert.equal(model.uploading,false);
model.tts({state:'sentence_start',text:'こんにちは！'});
assert.equal(events.at(-1).text,'こんにちは！','a real recognized turn still receives speech');
model.replyRequested=false;model.detectWakeWord({text:'挨拶して'});model.tts({state:'start'});
assert.equal(model.suppressReply,false,'explicit greeting still receives speech');
console.log('PASS: idle farewell suppressed, listening resumed, real speech and explicit greeting preserved');

model.detectWakeWord({text:'起動時の挨拶'});model.replyDeadline=Date.now()-1;before=events.length;model.tts({state:'start'});assert.equal(events.slice(before).filter(e=>e.id!=='uploadState').length,0);assert.equal(model.suppressReply,true,'an expired greeting must not authorize a later idle farewell');

model.stt({text:'名前を登録して会話を続けて'});model.tts({state:'start'});
model.replyActive=false;model.tts({state:'start'});
assert.equal(model.suppressReply,false,'a tool continuation within the same recognized turn must not be suppressed');
model.replyDeadline=Date.now()-1;model.tts({state:'start'});
assert.equal(model.suppressReply,true,'the same turn must not authorize an idle farewell after expiry');
console.log('PASS: tool continuation speech remains allowed while idle farewell expires');
