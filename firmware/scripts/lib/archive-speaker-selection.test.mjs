import {fileURLToPath} from 'node:url';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
const root=fileURLToPath(new URL('../../host/app/',import.meta.url));let data={api:{gemini:'DUMMY_KEY'},conversationProvider:'gemini',chatMode:false,directChat:{cloudConsent:true,endpoint:'wss://api.tenclass.net/test',deviceId:'00:00:00:00:00:00',clientId:'test-client',accessToken:'dummy',provisionedAt:Date.now()}};
const sql=new DatabaseSync(':memory:');let sequence=0;const memContext=vm.createContext({native:()=>((q,args)=>sql.prepare(q).all(...args))});const sd=new vm.SyntheticModule(['withSDCard'],function(){this.setExport('withSDCard',fn=>fn({createDirectory(){},scan(){return []}}));},{context:memContext});const vault=new vm.SyntheticModule(['randomHex','getSettings'],function(){this.setExport('randomHex',()=>('person-'+(++sequence)));this.setExport('getSettings',()=>data);},{context:memContext});const module=new vm.SourceTextModule(fs.readFileSync(root+'archive-memory.js','utf8'),{context:memContext});await module.link(name=>name==='stackchan-sdcard'?sd:vault);await module.evaluate();const memory=module.namespace;
const alice=memory.saveUser({name:'Alice',likes:['りんご'],about:'明示されたプロフィール'}).users[0],bob=memory.saveUser({name:'Bob'}).users[0];let now=Date.now();for(const person of [alice,bob]){memory.identifySpeaker({id:person.id,name:person.name});for(let n=0;n<5;n++)memory.recordMemory({id:person.id+'-'+n,role:n%2?'assistant':'user',text:person.name+'専用履歴'+n,created:now++});}assert.equal(memory.history({user_id:alice.id,limit:3}).items.length,3);assert.ok(memory.history({user_id:alice.id,limit:10}).items.every(m=>m.text.startsWith('Alice')));memory.beginConversation();
let opened=0,connections=[];class Chat{constructor(o){this.options=o;connections.push(o);}setVolume(){}start(){}close(){}sendFunctionResult(){}}
const c={getSettings:()=>data,changeSettings:fn=>fn(data),...Object.fromEntries(['currentSpeaker','identifySpeaker','users','saveUser','history','beginConversation'].map(k=>[k,memory[k]])),setXiaoZhiVision(){},setVisionProvisioner(){},openSpeakerChooser(){opened++;},startSpeakerChooser(){},getSettingsStatus:()=>({connected:true}),DEFAULT_GEMINI_MODEL:'gemini-test',ChatService:Chat,ChatState:{FAILED:0,DISCONNECTED:1,CONNECTED:4,SPEAKING:5,LISTENING:6,WAITING:7},ArchiveChatAudioIO:class{},createXiaozhiV1Connection:opts=>opts,Timer:{set:()=>1,clear(){},repeat:()=>1},trace(){},listDeviceTools:()=>[],memoryTools:[{name:'conversation_identify'}],visionTools:[],callMemory(){},URL,robotStub:{showBalloon(){},ui:{showFace(){},application:{behavior:{},distribute(){}}},drawer:{setDrawerButtonState(){}},audio:{volume:.1,acquireExclusive:()=>()=>{}}}};
const schema=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(root+'archive-button-schema.js')).toString('base64'));const registration=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(root+'archive-speaker-registration.js')).toString('base64'));c.VoiceRegistration=registration.VoiceRegistration;c.enrollmentInstructions=registration.enrollmentInstructions;c.registrationName=registration.registrationName;c.explicitSpeakerName=registration.explicitSpeakerName;c.ollamaChat=async()=> 'Ollama回答';c.ollamaModel=()=>data.ollamaModel||'gemma4:31b';c.validOllamaModel=v=>/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(v);c.OLLAMA_SPEECH_INSTRUCTIONS='音声だけ。ollama_replyを呼ぶ';c.ollamaSpeechTool={name:'ollama_reply'};c.speakerButtons=schema.speakerButtons;vm.createContext(c);vm.runInContext(fs.readFileSync(root+'archive-direct-chat.js','utf8').replace(/^import [\s\S]*? from '[^']+';?\s*$/gm,'').replace(/export /g,''),c);vm.runInContext('robot=robotStub;claim=()=>true;release=()=>{};',c);
vm.runInContext('setChatMode(true)',c);assert.equal(vm.runInContext('directChatStatus().requiresSpeaker',c),true);assert.equal(opened,0);await vm.runInContext('connect()',c);assert.equal(connections.length,1);assert.ok(connections[0].config.instructions.includes('conversation_identify'));
const selected=vm.runInContext('selectSpeaker({id:'+JSON.stringify(alice.id)+',name:"Alice"})',c);assert.equal(selected.historyRead,3);await vm.runInContext('connect()',c);assert.equal(connections.length,2);assert.ok(connections[1].config.instructions.includes('Alice'));assert.ok(!connections[1].config.instructions.includes('Bob専用'));assert.ok(Object.keys(connections[1].tools).includes('conversation_identify'));
vm.runInContext("configureChatProvider({provider:'xiaozhi'})",c);await vm.runInContext('connect()',c);assert.equal(memory.currentSpeaker().id,alice.id);vm.runInContext('setChatMode(false)',c);assert.equal(memory.currentSpeaker(),null);vm.runInContext('setChatMode(true)',c);assert.equal(vm.runInContext('directChatStatus().requiresSpeaker',c),true);assert.equal(vm.runInContext('selectSpeaker({guest:true}).historyRead',c),0);
assert.throws(()=>schema.invokeButton({text:'bad',background:'#112233',textColor:'#ffffff',method:'toString'},{}));let pressed;schema.invokeButton({text:'タイマー',background:'#112233',textColor:'#ffffff',method:'timer_create',args:{seconds:30}},{timer_create:args=>pressed=args.seconds});assert.equal(pressed,30);
class Node{constructor(data,options){Object.assign(this,options);this.skin=options.skin;}}
const buttonContext={Container:Node,Label:Node,Skin:class{},Style:class{},uiFont:()=>'',Behavior:class{},validateButton:schema.validateButton,invokeButton:schema.invokeButton};vm.createContext(buttonContext);vm.runInContext(fs.readFileSync(root+'archive-ui-button.js','utf8').replace(/^import [\s\S]*? from '[^']+';?\s*$/gm,'').replace(/export /g,''),buttonContext);let calls=0;buttonContext.methods={go:()=>calls++};const button=vm.runInContext("createUIButton({text:'登録',background:'#167647',textColor:'#ffffff',method:'go'},methods)",buttonContext);const behavior=new button.Behavior();behavior.onTouchBegan(button,0,0,0);behavior.onTouchMoved(button,0,20,0);behavior.onTouchEnded(button);await new Promise(r=>setTimeout(r,0));assert.equal(calls,0);behavior.onTouchBegan(button,0,0,0);behavior.onTouchEnded(button);behavior.onTouchEnded(button);await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);assert.equal(button.active,true);
console.log('PASS: no microphone session before selection, bounded isolated person history, profile context, provider changes preserve identity, guest isolation, no voice identity override, safe named button methods, drag cancellation/debounce');
assert.throws(()=>vm.runInContext("selectSpeaker({name:' stackchan '},true)",c));assert.equal(memory.users({id:'stackchan-self'}).users[0].kind,'robot');console.log('Robot profile is protected from duplicate-name person registration: PASS');

memory.identifySpeaker({id:alice.id,name:alice.name});const snapshot=memory.currentSpeaker().id;memory.identifySpeaker({id:bob.id,name:bob.name});memory.recordMemory({id:'late-photo-answer',role:'assistant',text:'遅れて届いた画像回答',created:now+100,speakerId:snapshot});assert.ok(memory.history({user_id:alice.id,limit:10}).items.some(m=>m.id==='late-photo-answer'));assert.ok(!memory.history({user_id:bob.id,limit:10}).items.some(m=>m.id==='late-photo-answer'));memory.recordMemory({id:'unattributed-legacy',role:'user',text:'話者不明の旧記録',created:now+101,speakerId:null});assert.ok(!memory.history({user_id:bob.id,limit:10}).items.some(m=>m.id==='unattributed-legacy'));console.log('Late image replies keep original speaker; legacy/guest messages are not attributed to the active person: PASS');

const beforeRegistrationConnections=connections.length;
vm.runInContext('setChatMode(false);beginVoiceRegistration()',c);
assert.equal(connections.length,beforeRegistrationConnections+1);
assert.equal(vm.runInContext('speakerList().enrollment.ready',c),false);
connections.at(-1).callbacks.onStateChanged(c.ChatState.CONNECTED);
assert.equal(vm.runInContext('speakerList().enrollment.ready',c),true);
const beforePeople=memory.users({limit:50}).users.length;
assert.equal(memory.currentSpeaker(),null);
await vm.runInContext('connect()',c);
const enrollmentConnection=connections.at(-1);
assert.equal(Object.keys(enrollmentConnection.tools).length,0);
enrollmentConnection.callbacks.onInputTranscript('私の名前はユキです。',false);
assert.equal(vm.runInContext('speakerList().enrollment.name',c),'ユキ');
assert.equal(memory.users({limit:50}).users.length,beforePeople);
vm.runInContext('closeChat()',c);const connectionCount=connections.length;
await vm.runInContext('connect()',c);assert.equal(connections.length,connectionCount);
vm.runInContext('confirmVoiceRegistration()',c);
assert.equal(memory.currentSpeaker().name,'ユキ');assert.equal(vm.runInContext('speakerList().enrollment',c),null);
assert.equal(memory.users({limit:50}).users.length,beforePeople+1);
vm.runInContext('beginVoiceRegistration();receiveRegistrationName("タイマーをかけて");',c);
assert.equal(vm.runInContext('speakerList().enrollment.name',c),'');assert.throws(()=>vm.runInContext('confirmVoiceRegistration()',c));
vm.runInContext('cancelVoiceRegistration()',c);assert.equal(data.chatMode,false);assert.equal(memory.currentSpeaker(),null);
assert.equal(vm.runInContext('registrationName("太郎と呼んでください")',c),'太郎');
console.log('Voice registration: explicit start, no premature profile save, confirm-only persistence, unrelated speech rejected, cancel stops microphone: PASS');

const isolatedRegistration=new registration.VoiceRegistration();
assert.equal(isolatedRegistration.active,false);
assert.equal(isolatedRegistration.receive('Alice'),false);
assert.throws(()=>isolatedRegistration.confirmedName());
isolatedRegistration.start();
const registrationSnapshot=isolatedRegistration.snapshot();registrationSnapshot.phase='confirming';registrationSnapshot.name='wrong';
assert.equal(isolatedRegistration.phase,'listening');
assert.equal(isolatedRegistration.receive('Alice'),true);
assert.equal(isolatedRegistration.receive('Bob'),false);
assert.equal(isolatedRegistration.confirmedName(),'Alice');
isolatedRegistration.reset();assert.equal(isolatedRegistration.snapshot(),null);assert.throws(()=>isolatedRegistration.confirmedName());
console.log('Registration state is isolated from UI snapshots and accepts only one provisional name per attempt: PASS');

class SpeakerViewNode{constructor(_data,options){Object.assign(this,options);this.children=[];}add(child){this.children.push(child);}empty(){this.children=[];}}
let speakerDefinition,viewState={...schema.speakerButtons([])};
const viewContext={Container:SpeakerViewNode,Label:SpeakerViewNode,Text:SpeakerViewNode,Skin:class{},Style:class{},uiFont:()=>'',createUIButton:(definition,methods,layout)=>({...definition,...layout,press:()=>schema.invokeButton(definition,methods)})};
vm.createContext(viewContext);
vm.runInContext(fs.readFileSync(root+'archive-speaker-ui.js','utf8').replace(/^import [\s\S]*? from '[^']+';?\s*$/gm,'').replace(/export /g,''),viewContext);
let registrationStarts=0,confirmations=0,cancellations=0;
viewContext.device={ui:{miniApps:{register:d=>speakerDefinition=d}},showBalloon(){}};
viewContext.callbacks={list:()=>viewState,registration:()=>registrationStarts++,confirm:()=>confirmations++,cancel:()=>cancellations++};
vm.runInContext('startSpeakerChooser(device,callbacks)',viewContext);
viewState={people:[],buttons:schema.speakerButtons([]),enrollment:null};let screen=speakerDefinition.create().content;
screen.children.find(n=>n.method==='register').press();assert.equal(registrationStarts,1);
viewState.enrollment={phase:'listening',name:''};screen=speakerDefinition.create().content;
assert.ok(screen.children.some(n=>n.method==='cancel'));assert.ok(!screen.children.some(n=>n.method==='confirm'));
assert.ok(screen.children.some(n=>n.method==='retry'));
const preparingText=screen.children.find(n=>n.string)?.string;
viewState.enrollment.ready=true;screen=speakerDefinition.create().content;
assert.notEqual(screen.children.find(n=>n.string)?.string,preparingText);
viewState.enrollment={phase:'confirming',name:'ユキ'};screen=speakerDefinition.create().content;
screen.children.find(n=>n.method==='confirm').press();assert.equal(confirmations,1);
screen.children.find(n=>n.method==='cancel').press();assert.equal(cancellations,1);
assert.ok(screen.children.filter(n=>n.method).every(n=>n.top+n.height<=196));
console.log('On-device speaker view: registration dispatch, listening/confirmation controls, cancel and buttons fit viewport: PASS');

vm.runInContext('setChatMode(false)',c);const originalGemini=data.api.gemini;
vm.runInContext("configureChatProvider({provider:'ollama',apiKey:'DUMMY_OLLAMA_KEY',model:'gemma4:31b'})",c);
assert.equal(data.api.gemini,originalGemini);assert.equal(data.api.ollama,'DUMMY_OLLAMA_KEY');assert.equal(vm.runInContext('chatProvider()',c),'ollama');
assert.throws(()=>vm.runInContext("configureChatProvider({provider:'ollama',model:'https://bad host'})",c));
vm.runInContext('selectSpeaker({guest:true})',c);await vm.runInContext('connect()',c);
const ollamaVoice=connections.at(-1);assert.deepEqual(Object.keys(ollamaVoice.tools),['ollama_reply']);assert.equal(ollamaVoice.config.apiKey,originalGemini);
let brainCalls=0,functionReply;c.ollamaChat=async(messages,tools,run,isCurrent)=>{brainCalls++;assert.equal(messages[1].content,'こんにちは');assert.equal(isCurrent(),true);return 'Ollamaが生成した返答';};Chat.prototype.sendFunctionResult=function(call,name,result){functionReply=result;};
ollamaVoice.callbacks.onFunctionCall('test-call','ollama_reply',{text:'こんにちは'});await new Promise(r=>setTimeout(r,0));assert.equal(brainCalls,1);assert.equal(functionReply.answer,'Ollamaが生成した返答');
vm.runInContext('setChatMode(false)',c);console.log('Ollama voice: independent key/model, Gemini speech-only tool, cloud-generated answer dispatch: PASS');

const shown=[];c.robotStub.showBalloon=text=>shown.push(text);c.archiveRecords=[];vm.runInContext('archive=(role,text)=>archiveRecords.push({role,text});selectSpeaker({guest:true})',c);await vm.runInContext('connect()',c);
const displayCallbacks=connections.at(-1).callbacks;const longAnswer='長い回答の確認です。'.repeat(40);displayCallbacks.onOutputTranscript(longAnswer,true);displayCallbacks.onOutputTranscript('',false);assert.equal(shown.at(-1),longAnswer);assert.equal(c.archiveRecords.at(-1).text,longAnswer);vm.runInContext('setChatMode(false)',c);displayCallbacks.onOutputTranscript('以前の相手への回答',false);assert.equal(shown.at(-1),longAnswer);console.log('Completed AI answer is shown without truncation; obsolete session cannot replace the balloon: PASS');

c.modeEvents=[];c.blockCloud=true;vm.runInContext("modeChanged=on=>{if(on&&blockCloud)throw new Error('local speech busy');modeEvents.push(on);}",c);assert.throws(()=>vm.runInContext('setChatMode(true)',c));assert.equal(data.chatMode,false);c.blockCloud=false;const selectedService=data.conversationProvider;vm.runInContext('setChatMode(true)',c);assert.equal(c.modeEvents.at(-1),true);assert.equal(data.conversationProvider,selectedService);assert.equal(vm.runInContext('directChatStatus().requiresSpeaker',c),true);vm.runInContext('setChatMode(false)',c);
let microphoneEnabled;c.Timer.set=(fn,ms)=>{if(!ms)queueMicrotask(fn);return 1;};Chat.prototype.setMicrophoneEnabled=function(on){microphoneEnabled=on;};Chat.prototype.start=function(){queueMicrotask(()=>this.options.callbacks.onStateChanged(c.ChatState.CONNECTED));};
for(const provider of ['gemini','xiaozhi']){const result=await vm.runInContext('testDirectConnection('+JSON.stringify(provider)+')',c);assert.equal(result.connected,true);assert.equal(result.provider,provider);assert.equal(result.microphoneTransmission,false);assert.equal(microphoneEnabled,false);assert.equal(data.conversationProvider,selectedService);}
console.log('PASS: online mode hook blocks overlapping speech, preserves service and speaker gate; both silent transport probes keep microphone disabled');

let recognitionProgress='';c.progress=value=>recognitionProgress=value;c.Timer.schedule=()=>{};
Chat.prototype.start=function(){queueMicrotask(()=>{this.options.callbacks.onStateChanged(c.ChatState.CONNECTED);this.options.callbacks.onInputTranscript?.('こんにちは',false);});};
const priorArchiveCount=c.archiveRecords.length;const recognition=await vm.runInContext("testDirectConnection('gemini',{recognition:true,progress})",c);assert.equal(recognition.transcript,'こんにちは');assert.equal(recognition.microphoneTransmission,true);assert.equal(microphoneEnabled,false);connections.at(-1).callbacks.onStateChanged(c.ChatState.CONNECTED);assert.equal(microphoneEnabled,false);assert.ok(recognitionProgress.includes('話してください'));assert.equal(c.archiveRecords.length,priorArchiveCount);assert.equal(data.conversationProvider,selectedService);
console.log('PASS: bounded recognition test enables microphone only for explicit test, returns text without conversation history or provider changes');

// Launcher actions close before changing mode, keeping the speaker chooser visible.
const queuedActions=[], talkApps=new Map();let talkEnabled=false, toggles=0, closes=0, notices=0;
c.Container=class{};c.Timer.set=fn=>{queuedActions.push(fn);return 1};
c.talkRobot={showBalloon(){notices++},ui:{miniApps:{register(definition){assert.ok(!talkApps.has(definition.id));talkApps.set(definition.id,definition);return()=>talkApps.delete(definition.id)}}}};
c.talkActions={enabled:()=>talkEnabled,toggle:()=>{talkEnabled=!talkEnabled;toggles++}};
vm.runInContext('registerAITalk(talkRobot,talkActions)',c);
assert.equal(talkApps.get('archive-ai-talk').hidden,undefined);
assert.ok(talkApps.get('archive-ai-talk').title.endsWith('OFF'));
for(const expected of [true,false]){
  talkApps.get('archive-ai-talk').create({close(){closes++}});
  assert.equal(toggles,closes-1);
  queuedActions.shift()();assert.equal(talkEnabled,expected);
  assert.ok(talkApps.get('archive-ai-talk').title.endsWith(expected?'ON':'OFF'));
}
c.talkActions.toggle=()=>{throw Error('Not configured')};
talkApps.get('archive-ai-talk').create({close(){closes++}});queuedActions.shift()();
assert.equal(talkEnabled,false);assert.equal(notices,1);
console.log('AI talk launcher: one toggle per launch after close, state label refresh, configuration failures stay off: PASS');

const beforeVoiceUsers=memory.users({limit:50}).users.length;
memory.beginConversation();memory.recordMemory({id:'identity-utterance',role:'user',text:'私はミナです',created:Date.now(),speakerId:null});
const resolved=memory.identifySpeaker({name:'ミナ',source_message_id:'identity-utterance'});
assert.equal(resolved.identified,true);assert.equal(memory.users({limit:50}).users.length,beforeVoiceUsers+1);
assert.ok(memory.history({user_id:resolved.person.id}).items.some(m=>m.id==='identity-utterance'));
assert.equal(sql.prepare('SELECT user FROM talk_history WHERE id=?').get('identity-utterance').user,resolved.person.id);
memory.saveUser({id:resolved.person.id,name:'ミナ',family:'姉がいる',hobbies:'読書',location:'東京',stackchan_name:'ちゃん'});
const savedProfile=memory.users({id:resolved.person.id}).users[0];assert.equal(savedProfile.family,'姉がいる');assert.equal(savedProfile.hobbies,'読書');
assert.equal(sql.prepare('SELECT location FROM user_profile WHERE id=?').get(resolved.person.id).location,'東京');
memory.beginConversation();const again=memory.identifySpeaker({name:'ミナ'});assert.equal(again.person.id,resolved.person.id);assert.ok(again.person.lastConversation);assert.ok(again.recent.length);
console.log('AI identity: new/existing person, first utterance attribution, profile detail preservation, compatibility views and recent context: PASS');

// Exercise the AI callback -> SD memory -> tool response path, not just the database helper.
Chat.prototype.start=function(){};
c.Timer.set=()=>1;c.memoryTools=memory.memoryTools;c.callMemory=memory.callMemory;
c.Container=class{constructor(data,options){Object.assign(this,options);this.children=[]}add(child){this.children.push(child)}};
c.ActionButton=class{constructor(data,options){Object.assign(this,options);this.data=data}};
c.robotStub.ui.addEffect=()=>{};c.robotStub.ui.removeEffect=()=>{};c.robotStub.hideBalloon=()=>{};
let toolReply;Chat.prototype.sendFunctionResult=function(call,name,result){toolReply={call,name,result}};
c.archiveEvent=(role,text)=>{const e={id:'ai-callback-'+(++sequence),role:role==='input'?'user':'assistant',text,created:Date.now()};memory.recordMemory(e);return e};
data.conversationProvider='gemini';
vm.runInContext('setChatMode(false);archive=archiveEvent;setChatMode(true)',c);await vm.runInContext('connect()',c);
const aiSession=connections.at(-1);aiSession.callbacks.onInputTranscript('私の名前はアオです',false);
aiSession.callbacks.onFunctionCall('identity-call','conversation_identify',{name:'アオ'});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(toolReply.result.identified,true);assert.equal(toolReply.result.newUser,false); // explicit transcript already saved this person
assert.equal(memory.users({name:'アオ'}).users.length,1);
assert.equal(memory.currentSpeaker().name,'アオ');
assert.ok(memory.history({user_id:memory.currentSpeaker().id}).items.some(m=>m.text==='私の名前はアオです'));
assert.ok(toolReply.result.now);assert.ok(Array.isArray(toolReply.result.recent));
vm.runInContext('setChatMode(false)',c);
console.log('AI session callback: spoken name identifies/saves person, first message linked, bounded context returned: PASS');

const micLights=[];c.robotStub.lightOn=(...args)=>micLights.push(['on',...args]);c.robotStub.lightOff=(...args)=>micLights.push(['off',...args]);
vm.runInContext('microphoneIndicator(true);microphoneIndicator(true);microphoneIndicator(false)',c);
assert.equal(micLights.length,2);assert.deepEqual(micLights[0],['on','head',0,48,0]);assert.equal(micLights[1][0],'off');
console.log('Microphone indicator: green while recording, repeated PCM does not rewrite LED, stop clears LED: PASS');

let greetingRoute;
Chat.prototype.sendText=function(text){greetingRoute='text';assert.ok(text.length<100)};
Chat.prototype.notifyWakeWordDetected=function(){greetingRoute='detect'};
c.Timer.set=(fn,ms)=>{if(!ms)queueMicrotask(fn);return 1};
for(const provider of ['xiaozhi','gemini']){
  vm.runInContext('setChatMode(false)',c);data.conversationProvider=provider;
  vm.runInContext('setChatMode(true)',c);await vm.runInContext('connect()',c);
  connections.at(-1).callbacks.onStateChanged(c.ChatState.CONNECTED);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(greetingRoute,provider==='xiaozhi'?'detect':'text');
}
vm.runInContext('setChatMode(false)',c);
console.log('Greeting transport: XiaoZhi uses supported detect notification, Gemini uses text: PASS');

// Real adapter forwards the microphone's channel count, including the default mono build.
class AdapterBase{constructor(){}ensureInput(){}}
let forwarded;
class AdapterWorker{postMessage(message){forwarded=message}terminate(){}}
const adapterContext=vm.createContext({ChatAudioIOBase:AdapterBase,Worker:AdapterWorker,SharedArrayBuffer,trace(){},writePcmRing(){},globalThis:{}});
vm.runInContext(fs.readFileSync(root+'archive-chat-audioio.js','utf8').replace(/^import .*$/gm,'').replace('export default class ChatAudioIO','class ChatAudioIO'),adapterContext);
for(const channels of [1,2]){
 adapterContext.channelCount=channels;
 vm.runInContext("var adapter=new ChatAudioIO();adapter.input={channels:channelCount};adapter.createWorker('archiveGeminiLive');adapter.worker.postMessage({id:'sendAudio',offset:0,size:960})",adapterContext);
 assert.equal(forwarded.channels,channels);
}
console.log('Microphone format: actual mono/stereo channel count forwarded to cloud audio conversion: PASS');

let ringChannels;adapterContext.writePcmRing=(...args)=>{ringChannels=args[5]};
for(const channels of [1,2]){
 adapterContext.channelCount=channels;
 vm.runInContext("adapter=new ChatAudioIO();adapter.input={channels:channelCount};adapter.inputBuffer=new SharedArrayBuffer(4096);adapter.createWorker('xiaozhiV1');adapter.worker.postMessage({id:'sendAudio',offset:0,size:960})",adapterContext);
 assert.equal(ringChannels,channels);
}
console.log('XiaoZhi PCM ring: native converter uses actual input channels as well: PASS');

let audioCallback,actualReads=0,postedFrames=[];
AdapterBase.SPEAKING=4;AdapterBase.DISCONNECTED=0;
adapterContext.AudioIn=class{constructor(options){audioCallback=options.onReadable;this.channels=1}start(){}read(){actualReads++;return actualReads===1?new Int16Array([1,2,3,4]).buffer:undefined}};
adapterContext.frame=m=>postedFrames.push(m);
vm.runInContext("adapter=new ChatAudioIO();adapter.microphone=true;adapter.inputBuffer=new SharedArrayBuffer(512);adapter.inputBufferSize=512;adapter.inputBufferOffset=0;adapter.state=4;adapter.ready=true;adapter.onInputLevelChanged=()=>{};adapter.worker={postMessage:frame};adapter.ensureInput()",adapterContext);
audioCallback(99999);audioCallback(99999);
assert.equal(postedFrames.length,1);assert.equal(postedFrames[0].size,8);assert.equal(postedFrames[0].channels,1);
console.log('Microphone stale notifications: current available bytes read, empty callbacks ignored: PASS');

assert.equal(registration.explicitSpeakerName('私の名前はハルです。'),'ハル');
assert.equal(registration.explicitSpeakerName('ハルです'),'ハル');
for(const text of ['はい','いいえ','元気です','こんにちは','タイマーをかけて'])assert.equal(registration.explicitSpeakerName(text),'');
console.log('Explicit self-introduction parser accepts names and leaves confirmations/commands to AI: PASS');

const playbackModule=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(root+'archive-playback-buffer.js')).toString('base64'));
adapterContext.PlaybackBuffer=playbackModule.PlaybackBuffer;
let writableCallback,closedOutput=false,playbackClock=0;
adapterContext.Date={now:()=>playbackClock};
adapterContext.AudioOut=class{constructor(options){writableCallback=options.onWritable}write(){}start(){}close(){closedOutput=true}};
AdapterBase.WAITING=6;AdapterBase.LISTENING=5;
vm.runInContext("adapter=new ChatAudioIO();adapter.outputBufferSize=64;adapter.outputSampleRate=1000;adapter.outputBuffer=new SharedArrayBuffer(64);adapter.outputBufferHead=40;adapter.outputBufferTail=0;adapter.barrier=new Int32Array(new SharedArrayBuffer(4));adapter.state=5;adapter.onOutputLevelChanged=()=>{};adapter.onStateChanged=()=>{};adapter.worker={postMessage:frame};adapter.ensureOutput()",adapterContext);
for(let i=0;i<5;i++)writableCallback(8);
vm.runInContext('adapter.state=6',adapterContext);writableCallback(8);
assert.equal(closedOutput,false);playbackClock=83;writableCallback(8);assert.equal(closedOutput,false);
playbackClock=85;writableCallback(8);assert.equal(closedOutput,true);
console.log('Playback drain: final queued audio is not closed immediately, microphone resumes after drain allowance: PASS');
