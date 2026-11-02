import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let wall=0,ticks=0,settings={reminders:[]},saved=0,spoken=[],released=0;const callbacks=[];
class ClockDate extends Date{constructor(...args){super(...(args.length?args:[wall]));}static now(){return wall;}}
let registers=Uint8Array.of(0x10,0x20,0x03,0x31,6,0x10,0x26);
class SMBus{readBuffer(_reg,b){b.set(registers);}readUint8(){return 0;}writeUint8(){}writeBuffer(_reg,b){registers=Uint8Array.from(b);}close(){}}
class Node{constructor(_,o){Object.assign(this,o);this.children=[];}add(n){this.children.push(n);}}
const context=vm.createContext({Date:ClockDate,trace(){},device:{io:{SMBus},i2c:{internal:{}}},String:Object.assign(String,{fromArrayBuffer:b=>Buffer.from(b).toString()})});
let failSpeech=false;
const deps={time:{default:{get ticks(){return ticks;},set(seconds){wall=seconds*1000;}}},timer:{default:{repeat(fn,ms){callbacks.push({fn,ms});return 1;},set(fn){fn();return 1;}}},'archive-vault':{getSettings:()=>settings,changeSettings:fn=>{fn(settings);saved++;},randomHex:()=>String(saved).padStart(8,'0')},Resource:{default:class{constructor(){return Buffer.from(fs.readFileSync(new URL('../../host/app/reminder-tools.json',import.meta.url)));}}},'archive-alarm-sound':{playAlarmSound:async()=>true,stopAlarmSound(){}},'archive-offline-tts':{TTS:class{stream(text,volume,done){spoken.push({text,volume});done(failSpeech?new Error('speaker failed'):undefined);}}},'piu/MC':{Container:Node,Label:Node,Text:Node,Skin:class{},Style:class{}},'ui-theme':{uiFont:()=>''},'archive-ui-button':{createUIButton:(d,m,l)=>({...d,...l,press:()=>m[d.method]()})}};
const cache=new Map();async function load(name){if(cache.has(name))return cache.get(name);let module;
if(deps[name]){const values=deps[name];module=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});}
else if(['archive-local-clock','archive-tools','archive-reminder-time','archive-offline','archive-offline-speech'].includes(name))module=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/app/'+name+'.js',import.meta.url),'utf8'),{context});
else throw new Error('Offline module attempted unexpected dependency: '+name);
cache.set(name,module);await module.link(load);return module;}
const clockModule=await load('archive-local-clock');await clockModule.evaluate();const clock=clockModule.namespace;
for(const when of ['2026-01-01T00:00:00Z','2026-12-31T23:59:59Z','2028-02-29T10:25:30Z']){const epoch=Date.parse(when);assert.equal(clock.decodeRTC(clock.encodeRTC(epoch)),epoch);}
assert.throws(()=>clock.decodeRTC(Uint8Array.of(128,0,0,1,0,1,0x26)));
assert.throws(()=>clock.japaneseEpoch({year:2026,month:2,day:30,hour:0,minute:0}));
assert.equal(clock.japaneseEpoch({year:2026,month:10,day:31,hour:20,minute:0}),Date.parse('2026-10-31T11:00:00Z'));
clock.startLocalClock();assert.equal(clock.localClockStatus().restored,true);assert.equal(wall,Date.parse('2026-10-31T03:20:10Z'));
const toolsModule=await load('archive-tools');await toolsModule.evaluate();const tools=toolsModule.namespace;tools.startDeviceTools({drawer:{addDrawerButton(){}}},()=>false,()=>{});const poll=callbacks.find(c=>c.ms===1000).fn;
wall=0;ticks=0;const timer=tools.callDeviceTool('timer_create',{seconds:30});assert.equal(timer.clockPending,true);ticks=10000;poll();assert.equal(settings.reminders[0].status,'scheduled');
wall=Date.parse('2026-10-31T03:00:00Z');ticks=15000;poll();assert.equal(settings.reminders[0].status,'scheduled');assert.equal(settings.reminders[0].due-wall,15000);
wall+=3600000;ticks=20000;poll();assert.equal(settings.reminders[0].status,'scheduled');assert.equal(settings.reminders[0].due-wall,10000);
wall-=7200000;ticks=30000;poll();assert.equal(settings.reminders[0].status,'pending');
settings.reminders=[];wall=0;ticks=0xffffff00;tools.callDeviceTool('timer_create',{seconds:1});ticks=(ticks+1000)>>>0;poll();assert.equal(settings.reminders[0].status,'pending');
settings.reminders=[{id:'old-clockless',kind:'timer',clockPending:true,status:'scheduled',due:30000}];poll();assert.equal(settings.reminders[0].status,'cancelled');
wall=Date.parse('2026-10-31T03:00:00Z');let stoppedCloud=0,claimed=false,faceShown=0;const overlays=[],launched=[];let onlineStarts=0,aiSettings=0;
const offlineModule=await load('archive-offline');await offlineModule.evaluate();const offline=offlineModule.namespace;
offline.startOffline({showBalloon(){},drawer:{addDrawerButton(){}},ui:{showFace(){faceShown++;},addEffect(effect){overlays.push(effect);},removeEffect(effect){overlays.splice(overlays.indexOf(effect),1);},miniApps:{register(){}},application:{behavior:{launchMiniApp(id){launched.push(id);}}}},audio:{volume:.1,acquireExclusive:()=>()=>released++}},{stopCloud:()=>stoppedCloud++,claim:()=>{if(claimed)return false;claimed=true;return true;},release:()=>{claimed=false;},tool:tools.callDeviceTool,startCloud:()=>onlineStarts++,openAI:()=>aiSettings++});
assert.equal((await offline.offlineAction('hello')).spoken,true);assert.ok(spoken.some(p=>p.text.includes('こんにちは')));assert.equal(released,1);assert.equal(claimed,false);assert.equal(stoppedCloud,1);await offline.offlineAction('time');assert.ok(spoken.some(p=>p.text==='じゅうにじ。'));assert.equal(spoken.at(-1).text,'ちょうどです。');assert.equal(offline.offlineStatus().recognition,false);
console.log('PASS: RTC UTC/BCD and cold-boot restore, invalid dates/low voltage rejected, clockless timer, forward/backward wall jumps, tick wrap, restart policy, local Japanese TTS, audio release, no network dependencies');

offline.openOffline();assert.equal(faceShown,1);assert.equal(launched.length,0);assert.equal(overlays.length,1);assert.equal(offline.offlineStatus().faceButtonsVisible,true);
let strip=overlays[0];assert.equal(strip.bottom,0);assert.equal(strip.height,44);assert.ok(strip.children.every(b=>b.left+b.width<=320&&b.top+b.height<=44));
strip.children.find(b=>b.method==='next').press();strip=overlays[0];assert.ok(strip.children.some(b=>b.method==='timer'));
strip.children.find(b=>b.method==='timer').press();strip=overlays[0];assert.equal(launched.length,0);assert.ok(strip.children.some(b=>b.text==='3分 開始'));
strip.children.find(b=>b.method==='more').press();strip=overlays[0];assert.ok(strip.children.some(b=>b.text==='4分 開始'));
strip.children.find(b=>b.method==='back').press();strip=overlays[0];strip.children.find(b=>b.method==='close').press();assert.equal(overlays.length,0);assert.equal(offline.offlineStatus().faceButtonsVisible,false);
console.log('PASS: face stays main, bottom-only choices fit screen, paging and timer adjustment avoid mini-app navigation, close removes controls');

const speechModule=await load('archive-offline-speech');await speechModule.evaluate();const readings=speechModule.namespace;
assert.equal(readings.timeSpeech(14,30)[1].text,'じゅうよじ。');assert.equal(readings.timeSpeech(14,30)[2].text,'さんじゅっぷんです。');
for(const [n,expected]of [[1,'いっぷん'],[3,'さんぷん'],[6,'ろっぷん'],[10,'じゅっぷん'],[14,'じゅうよんぷん'],[59,'ごじゅうきゅうふん'],[100,'ひゃっぷん'],[120,'ひゃくにじゅっぷん']])assert.equal(readings.minuteReading(n),expected);
for(let hour=0;hour<24;hour++)for(let minute=0;minute<60;minute++){const parts=readings.timeSpeech(hour,minute);assert.ok(parts.slice(0,-1).every(p=>p.pause>=250));assert.ok(parts.every(p=>!/[0-9]/.test(p.text)));}
assert.throws(()=>readings.timeSpeech(24,0));assert.throws(()=>readings.timeSpeech(0,60));
console.log('PASS: explicit Japanese hour/minute readings and pauses for every clock time, minute counter pronunciation and invalid input checks');

offline.openOffline();for(let i=0;i<4&&!overlays[0].children.some(b=>b.method==='online');i++)overlays[0].children.find(b=>b.method==='next').press();overlays[0].children.find(b=>b.method==='online').press();assert.equal(onlineStarts,1);overlays[0].children.find(b=>b.method==='ai').press();assert.equal(aiSettings,1);offline.closeOffline();assert.equal(offline.offlineStatus().faceButtonsVisible,false);
console.log('PASS: bottom menu offers explicit online conversation and AI selection; online controls can remove offline overlay');

offline.openOffline();for(let i=0;i<5&&!overlays[0].children.some(b=>b.method==='timer');i++)overlays[0].children.find(b=>b.method==='next').press();overlays[0].children.find(b=>b.method==='timer').press();const oldStart=overlays[0].children.find(b=>b.method==='start');const beforeTimers=settings.reminders.filter(r=>r.kind==='timer').length;const pendingStart=oldStart.press();await oldStart.press();await pendingStart;assert.equal(settings.reminders.filter(r=>r.kind==='timer').length,beforeTimers+1);assert.ok(!overlays[0].children.some(b=>b.method==='start'));await oldStart.press();assert.equal(settings.reminders.filter(r=>r.kind==='timer').length,beforeTimers+1);
console.log('PASS: one offline timer per start panel; queued/repeated releases and stale start controls cannot schedule again; returns to regular choices');

for(let i=0;i<5&&!overlays[0].children.some(b=>b.method==='timer');i++)overlays[0].children.find(b=>b.method==='next').press();overlays[0].children.find(b=>b.method==='timer').press();const failedStart=overlays[0].children.find(b=>b.method==='start'),countBeforeFailure=settings.reminders.filter(r=>r.kind==='timer').length;failSpeech=true;await assert.rejects(()=>failedStart.press(),/設定済み/);await failedStart.press();assert.equal(settings.reminders.filter(r=>r.kind==='timer').length,countBeforeFailure+1);assert.ok(!overlays[0].children.some(b=>b.method==='start'));failSpeech=false;
console.log('PASS: a successfully saved timer remains one-shot even if acknowledgement speech fails');

const bootResult=await offline.offlineAction('boot');
assert.equal(bootResult.text,'スタックチャン');
assert.equal(spoken.at(-1).text,'すたっくちゃん。');
assert.equal(offline.offlineStatus().playing,false);
console.log('PASS: boot announcement says only the device name and releases audio after playback');

const bootPolicy=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-offline-speech.js',import.meta.url))).toString('base64'));
assert.equal(bootPolicy.bootSpeechEnabled({}),true);assert.equal(bootPolicy.bootSpeechEnabled({bootSpeak:true}),true);assert.equal(bootPolicy.bootSpeechEnabled({bootSpeak:false}),false);
console.log('PASS: startup local speech defaults on and respects an explicit off setting');

// A reboot during notification must suppress the interrupted occurrence only.
wall=Date.parse('2026-11-01T11:00:00Z');
settings.reminders=[{id:'interrupted-once',kind:'timer',status:'pending',notificationStarted:wall-1000,due:wall-1000},{id:'interrupted-daily',kind:'alarm',status:'pending',notificationStarted:wall-1000,due:wall-1000,repeat:'daily',hour:7,minute:10},{id:'untouched',kind:'alarm',status:'scheduled',due:wall+100000}];
tools.startDeviceTools({drawer:{addDrawerButton(){}}},()=>false,()=>{});
assert.equal(settings.reminders[0].status,'cancelled');
assert.equal(settings.reminders[1].status,'scheduled');assert.ok(settings.reminders[1].due>wall);assert.equal(settings.reminders[1].hour,7);assert.equal(settings.reminders[1].minute,10);
assert.equal(settings.reminders[2].due,wall+100000);assert.equal(settings.reminders[2].status,'scheduled');
const recovered=JSON.stringify(settings.reminders);tools.startDeviceTools({drawer:{addDrawerButton(){}}},()=>false,()=>{});assert.equal(JSON.stringify(settings.reminders),recovered);
console.log('PASS: interrupted notification cannot reboot-loop; daily reservation survives and unrelated jobs remain unchanged');
settings.reminders=[{id:'normal-daily',kind:'alarm',status:'pending',due:wall-1000,repeat:'daily',hour:7,minute:10}];
tools.startDeviceTools({drawer:{addDrawerButton(){}},showBalloon(){},hideBalloon(){}},()=>true,()=>{});
callbacks.filter(c=>c.ms===1000).at(-1).fn();
assert.equal(settings.reminders[0].notificationStarted,wall,'persist notification start before playing');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(settings.reminders[0].status,'scheduled');assert.equal(settings.reminders[0].notificationStarted,undefined,'normal completion clears recovery marker for next occurrence');
console.log('PASS: normal daily notification saves a start marker before playback and clears it on completion');
