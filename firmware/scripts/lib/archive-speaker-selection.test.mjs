import {fileURLToPath} from 'node:url';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
const root=fileURLToPath(new URL('../../host/app/',import.meta.url));let data={api:{gemini:'DUMMY_KEY'},conversationProvider:'gemini',chatMode:false,directChat:{cloudConsent:true,endpoint:'wss://api.tenclass.net/test',deviceId:'00:00:00:00:00:00',clientId:'test-client',accessToken:'dummy',provisionedAt:Date.now()}};
const sql=new DatabaseSync(':memory:');let sequence=0;const memContext=vm.createContext({native:()=>((q,args)=>sql.prepare(q).all(...args))});const sd=new vm.SyntheticModule(['withSDCard'],function(){this.setExport('withSDCard',fn=>fn({createDirectory(){},scan(){return []}}));},{context:memContext});const vault=new vm.SyntheticModule(['randomHex','getSettings'],function(){this.setExport('randomHex',()=>('person-'+(++sequence)));this.setExport('getSettings',()=>data);},{context:memContext});const module=new vm.SourceTextModule(fs.readFileSync(root+'archive-memory.js','utf8'),{context:memContext});await module.link(name=>name==='stackchan-sdcard'?sd:vault);await module.evaluate();const memory=module.namespace;
const alice=memory.saveUser({name:'Alice',likes:['りんご'],about:'明示されたプロフィール'}).users[0],bob=memory.saveUser({name:'Bob'}).users[0];let now=Date.now();for(const person of [alice,bob]){memory.identifySpeaker({id:person.id,name:person.name});for(let n=0;n<5;n++)memory.recordMemory({id:person.id+'-'+n,role:n%2?'assistant':'user',text:person.name+'専用履歴'+n,created:now++});}assert.equal(memory.history({user_id:alice.id,limit:3}).items.length,3);assert.ok(memory.history({user_id:alice.id,limit:10}).items.every(m=>m.text.startsWith('Alice')));memory.beginConversation();
let opened=0,connections=[];class Chat{constructor(o){this.options=o;connections.push(o);}setVolume(){}start(){}close(){}sendFunctionResult(){}}
const c={getSettings:()=>data,changeSettings:fn=>fn(data),...Object.fromEntries(['currentSpeaker','identifySpeaker','users','saveUser','history','beginConversation'].map(k=>[k,memory[k]])),setXiaoZhiVision(){},setVisionProvisioner(){},openSpeakerChooser(){opened++;},startSpeakerChooser(){},getSettingsStatus:()=>({connected:true}),DEFAULT_GEMINI_MODEL:'gemini-test',ChatService:Chat,ChatState:{FAILED:0,DISCONNECTED:1,CONNECTED:4,SPEAKING:5,LISTENING:6,WAITING:7},ArchiveChatAudioIO:class{},createXiaozhiV1Connection:opts=>opts,Timer:{set:()=>1,clear(){},repeat:()=>1},trace(){},listDeviceTools:()=>[],memoryTools:[{name:'conversation_identify'}],visionTools:[],callMemory(){},URL,robotStub:{showBalloon(){},ui:{showFace(){},application:{behavior:{},distribute(){}}},drawer:{setDrawerButtonState(){}},audio:{volume:.1,acquireExclusive:()=>()=>{}}}};
const schema=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(root+'archive-button-schema.js')).toString('base64'));const registration=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(root+'archive-speaker-registration.js')).toString('base64'));c.VoiceRegistration=registration.VoiceRegistration;c.enrollmentInstructions=registration.enrollmentInstructions;c.registrationName=registration.registrationName;c.ollamaChat=async()=> 'Ollama回答';c.ollamaModel=()=>data.ollamaModel||'gemma4:31b';c.validOllamaModel=v=>/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(v);c.OLLAMA_SPEECH_INSTRUCTIONS='音声だけ。ollama_replyを呼ぶ';c.ollamaSpeechTool={name:'ollama_reply'};c.speakerButtons=schema.speakerButtons;vm.createContext(c);vm.runInContext(fs.readFileSync(root+'archive-direct-chat.js','utf8').replace(/^import [\s\S]*? from '[^']+';?\s*$/gm,'').replace(/export /g,''),c);vm.runInContext('robot=robotStub;claim=()=>true;release=()=>{};',c);
vm.runInContext('setChatMode(true)',c);assert.equal(vm.runInContext('directChatStatus().requiresSpeaker',c),true);assert.equal(opened,1);await vm.runInContext('connect()',c);assert.equal(connections.length,0);
const selected=vm.runInContext('selectSpeaker({id:'+JSON.stringify(alice.id)+',name:"Alice"})',c);assert.equal(selected.historyRead,3);await vm.runInContext('connect()',c);assert.equal(connections.length,1);assert.ok(connections[0].config.instructions.includes('Alice'));assert.ok(!connections[0].config.instructions.includes('Bob専用'));assert.ok(!Object.keys(connections[0].tools).includes('conversation_identify'));
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
