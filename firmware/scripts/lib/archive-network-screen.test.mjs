import {fileURLToPath} from 'node:url';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let settings={connected:false,setupActive:false,ip:'',setupIP:''},opened=0,timers=[],apps={},drawers=[],removed=[];
class Node{constructor(data,options={}){Object.assign(this,options);this.children=[...(options.contents||[])];}add(n){this.children.push(n);}empty(){this.children=[];}}
const c={Timer:{repeat:fn=>{timers.push(fn);return fn;},clear:()=>{}},Container:Node,Label:Node,Text:Node,QRCode:Node,Skin:class{},Style:class{},ActionButton:class extends Node{constructor(data,options){super(data,options);this.data=data;}},uiFont:()=>'',getSettingsStatus:()=>settings,openSettings:()=>{opened++;settings.setupActive=true;settings.setupIP='192.168.4.1';return {wifiQR:'WIFI:TEST'};},PAGE:'',HttpServerService:class{get(){}post(){}},ArchiveHTTPServer:class{},Response:class{}};
const robot={ui:{miniApps:{register:d=>apps[d.id]=d},application:{behavior:{closeDrawer(){},launchMiniApp(id){active?.dispose?.();active=apps[id].create();return true;}}}},drawer:{removeDrawerButton(key){removed.push(key);},addDrawerButton:d=>drawers.push(d)}};let active;
let closeOfflineCalls=0;let automatic=true;c.callbacks={closeOffline:()=>closeOfflineCalls++,diagnostics:()=>({wifi:{connected:true,ip:'192.168.2.10'},signal:{rssi:-62,bars:3},ai:{provider:'gemini',configured:true,enabled:true,state:'listening',audio:{inputEvents:5,outputEvents:2}},volume:{percent:10},connection:{usb:true,enabled:true},local:{playing:false},clock:{ready:true}}),autoOffline:value=>{if(typeof value==='boolean')automatic=value;return {enabled:automatic};},openOffline:()=>{}};
vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../../host/app/archive-web.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,''),c);c.robotContext=robot;vm.runInContext("startWeb(robotContext,callbacks,'TEST_ACCESS')",c);
vm.runInContext("openControl('lan')",c);assert.equal(opened,0);assert.equal(vm.runInContext('controlStatus().screenQR',c),'waiting');settings={...settings,connected:true,ip:'192.168.2.33'};timers.at(-1)();assert.equal(vm.runInContext('controlStatus().screenQR',c),'waiting'); // server not started yet
// Pretend HTTP startup completed; rerender on readiness change.
vm.runInContext('server={}',c);timers.at(-1)();assert.equal(vm.runInContext('controlStatus().screenQR',c),'lan');assert.equal(opened,0);
vm.runInContext("openControl('ap')",c);assert.equal(opened,1);assert.equal(vm.runInContext('controlStatus().screenQR',c),'ap');vm.runInContext("openControl('lan')",c);assert.equal(opened,1);assert.equal(vm.runInContext('controlStatus().screenQR',c),'lan');assert.equal(drawers.length,1);assert.ok(Object.values(apps).filter(x=>x.id!=='archive-settings').every(x=>x.hidden));
settings.connected=false;settings.ip='';timers.at(-1)();assert.equal(vm.runInContext('controlStatus().screenQR',c),'waiting');assert.equal(opened,1);
console.log('PASS: LAN never auto-enables AP; DHCP/server readiness updates QR; prior AP choice never leaks into LAN; one settings entry; internal screens hidden');

robot.ui.application.behavior.launchMiniApp('archive-settings');assert.ok(active.content.children.some(n=>n.data?.label==='起動設定'));
robot.ui.application.behavior.launchMiniApp('archive-offline-settings');assert.equal(active.content.children[1].data.label,'USB・Wi-Fiなしで自動: ON');active.content.children[1].data.onTap();assert.equal(automatic,false);assert.equal(active.content.children[1].data.label,'USB・Wi-Fiなしで自動: OFF');

robot.ui.application.behavior.launchMiniApp('archive-device-info');assert.ok(active.content.children[0].string.includes('-62 dBm'));active.content.children[2].data.onTap();assert.ok(active.content.children[0].string.includes('gemini'));active.content.children[2].data.onTap();assert.ok(active.content.children[0].string.includes('音量: 10%'));assert.ok(active.content.children[0].string.includes('聞き取り中'));
console.log('PASS: organized settings navigation, auto toggle refresh, Wi-Fi / AI / audio diagnostics');

for(const key of ['cycleEmotion','servoTest','toggleLED','recordPlayback','speakStackchan'])assert.ok(removed.includes(key));

drawers[0].callback();assert.ok(closeOfflineCalls>0);assert.ok(active.content.children.some(x=>x.data?.label==='情報取得'));

robot.ui.application.behavior.launchMiniApp('archive-network-settings');assert.equal(active.content.children.length,5);const networkButtons=active.content.children.slice(1);assert.equal(new Set(networkButtons.map(b=>b.data.label)).size,networkButtons.length);const apStarts=opened;networkButtons[1].data.onTap();assert.equal(opened,apStarts);assert.equal(vm.runInContext('controlStatus().screenMode',c),'lan');
console.log('PASS: simplified connection choices are distinct and the single LAN action never starts setup WiFi');

settings.connected=true;settings.ip='192.168.2.33';vm.runInContext('server={}',c);const beforeAISetup=opened;robot.ui.application.behavior.launchMiniApp('archive-ai-setup');assert.ok(active.content.children.some(n=>n.string?.endsWith('#conversation')));assert.equal(opened,beforeAISetup);vm.runInContext("openControl('lan')",c);assert.ok(active.content.children.some(n=>n.string?.includes('?k=TEST_ACCESS')&&!n.string.includes('#conversation')));
console.log('PASS: AI setup opens its own LAN section without changing the regular operation QR or starting AP');

let bootEnabled=false;callbacksBoot();
function callbacksBoot(){c.callbacks.bootSpeech=value=>{if(typeof value==='boolean')bootEnabled=value;return bootEnabled};}
robot.ui.application.behavior.launchMiniApp('archive-boot-settings');
assert.ok(active.content.children[1].data.label.endsWith('OFF'));
active.content.children[1].data.onTap();assert.equal(bootEnabled,true);assert.ok(active.content.children[1].data.label.endsWith('ON'));
active.content.children[1].data.onTap();assert.equal(bootEnabled,false);
console.log('PASS: boot speech setting reads, persists through callback, and refreshes ON/OFF');
