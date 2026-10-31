import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let initialized=0,connected=false,tick,accept=false,pops=0;const queue=[],packets=[];
const c=vm.createContext({initDebugLog:()=>initialized++,pushDebugLog:text=>queue.push(text),popDebugLog:()=>{pops++;return queue.shift();},debugLogStatus:()=>({queued:queue.length,dropped:0}),usbConnected:()=>connected,writeDebugUSB:text=>{if(!accept)return false;packets.push(JSON.parse(text));return true;},Timer:{repeat:fn=>tick=fn},trace(){}});
vm.runInContext(fs.readFileSync(new URL('../../host/app/archive-debug.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export \{.*\};/g,'').replace(/export /g,''),c);
vm.runInContext('installDebugLog();installDebugLog();startDebugDrain()',c);assert.equal(initialized,1);tick();assert.equal(pops,0);
connected=true;tick();assert.equal(pops,0);vm.runInContext('armDebugDrain()',c);tick();const failedPops=pops;assert.equal(packets.length,0);accept=true;tick();assert.ok(packets.some(p=>p.lines[0].includes('release logging enabled')));assert.ok(pops>=failedPops);
packets.length=0;const text='あ'.repeat(399)+'🙂'+'続き'.repeat(500)+'\n';c.text=text;vm.runInContext('trace(text)',c);for(let i=0;i<4;i++)tick();assert.equal(packets.flatMap(p=>p.lines).join(''),text);for(const p of packets){assert.ok(Buffer.byteLength(JSON.stringify(p))<3500);assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p.lines[0]));}
console.log('PASS: release trace installation, disconnected buffering, nonblocking retry and Unicode-safe bounded transport');
