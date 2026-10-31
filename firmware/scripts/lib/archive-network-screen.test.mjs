import {fileURLToPath} from 'node:url';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let settings={connected:false,setupActive:false,ip:'',setupIP:''},opened=0,timers=[],apps={},drawers=[];
class Node{constructor(data,options={}){Object.assign(this,options);this.children=[...(options.contents||[])];}add(n){this.children.push(n);}empty(){this.children=[];}}
const c={Timer:{repeat:fn=>{timers.push(fn);return fn;},clear:()=>{}},Container:Node,Label:Node,Text:Node,QRCode:Node,Skin:class{},Style:class{},ActionButton:Node,uiFont:()=>'',getSettingsStatus:()=>settings,openSettings:()=>{opened++;settings.setupActive=true;settings.setupIP='192.168.4.1';return {wifiQR:'WIFI:TEST'};},PAGE:'',HttpServerService:class{get(){}post(){}},ArchiveHTTPServer:class{},Response:class{}};
const robot={ui:{miniApps:{register:d=>apps[d.id]=d},application:{behavior:{closeDrawer(){},launchMiniApp(id){active?.dispose?.();active=apps[id].create();return true;}}}},drawer:{addDrawerButton:d=>drawers.push(d)}};let active;
vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../../host/app/archive-web.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,''),c);c.robotContext=robot;vm.runInContext("startWeb(robotContext,{},'TEST_ACCESS')",c);
vm.runInContext("openControl('lan')",c);assert.equal(opened,0);assert.equal(vm.runInContext('controlStatus().screenQR',c),'waiting');settings={...settings,connected:true,ip:'192.168.2.33'};timers.at(-1)();assert.equal(vm.runInContext('controlStatus().screenQR',c),'waiting'); // server not started yet
// Pretend HTTP startup completed; rerender on readiness change.
vm.runInContext('server={}',c);timers.at(-1)();assert.equal(vm.runInContext('controlStatus().screenQR',c),'lan');assert.equal(opened,0);
vm.runInContext("openControl('ap')",c);assert.equal(opened,1);assert.equal(vm.runInContext('controlStatus().screenQR',c),'ap');vm.runInContext("openControl('lan')",c);assert.equal(opened,1);assert.equal(vm.runInContext('controlStatus().screenQR',c),'lan');assert.equal(drawers.length,1);assert.ok(Object.values(apps).every(x=>x.hidden));
settings.connected=false;settings.ip='';timers.at(-1)();assert.equal(vm.runInContext('controlStatus().screenQR',c),'waiting');assert.equal(opened,1);
console.log('PASS: LAN never auto-enables AP; DHCP/server readiness updates QR; prior AP choice never leaks into LAN; one settings entry; internal screens hidden');
