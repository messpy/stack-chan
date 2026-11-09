import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let initialized=0,connected=false,tick,accept=false,pops=0;const queue=[],packets=[];
const c=vm.createContext({initDebugLog:()=>initialized++,pushDebugLog:text=>queue.push(text),popDebugLog:()=>{pops++;return queue.shift();},debugLogStatus:()=>({queued:queue.length,dropped:0}),usbConnected:()=>connected,writeDebugUSB:text=>{if(!accept)return false;packets.push(JSON.parse(text));return true;},Timer:{repeat:fn=>tick=fn},trace(){}});
vm.runInContext(fs.readFileSync(new URL('../../host/app/archive-debug.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export \{.*\};/g,'').replace(/export /g,''),c);
vm.runInContext('installDebugLog();installDebugLog();startDebugDrain()',c);assert.equal(initialized,1);tick();assert.equal(pops,0);
connected=true;tick();assert.equal(pops,0);vm.runInContext('armDebugDrain()',c);tick();const failedPops=pops;assert.equal(packets.length,0);accept=true;tick();assert.ok(packets.some(p=>p.lines[0].includes('release logging enabled')));assert.ok(pops>=failedPops);
packets.length=0;const text='あ'.repeat(399)+'🙂'+'続き'.repeat(500)+'\n';c.text=text;vm.runInContext('trace(text)',c);for(let i=0;i<4;i++)tick();assert.equal(packets.flatMap(p=>p.lines).join(''),text);for(const p of packets){assert.ok(Buffer.byteLength(JSON.stringify(p))<3500);assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p.lines[0]));}
console.log('PASS: release trace installation, disconnected buffering, nonblocking retry and Unicode-safe bounded transport');

// Startup evidence is independent from RPC arming and does not leak message/stack bodies.
let online=false,nativeFails=false,wireFails=false;const checkpoints=[],startupPackets=[],ticks=[];
const sc=vm.createContext({trace(){},initDebugLog(){},pushDebugLog(){},popDebugLog(){},debugLogStatus:()=>({}),
 usbConnected:()=>online,heapStatus:()=>({internalFree:100,internalLargest:80,psramFree:200}),
 startupCheckpoint:(...args)=>{if(nativeFails)throw Error('native failure');checkpoints.push(args)},
 startupCheckpointStatus:()=>({sequence:2,stage:3,errorCode:2,previousValid:1,previousSequence:1,previousStage:2,previousError:0,resetReason:1}),
 writeDebugUSB:text=>{if(wireFails)throw Error('USB unavailable');startupPackets.push(JSON.parse(text));return true},
 Timer:{repeat:fn=>{ticks.push(fn);return ticks.length},clear(){}},
});
vm.runInContext(fs.readFileSync(new URL('../../host/app/archive-debug.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export \{.*\};/g,'').replace(/export /g,''),sc);
vm.runInContext("recordStartupCheckpoint('context')",sc);
assert.equal(checkpoints.length,1);assert.equal(startupPackets.length,0);
online=true;ticks[0]();assert.equal(startupPackets[0].event,'startup');assert.equal(startupPackets[0].phase,'context');
sc.failure={name:'TypeError',message:'secret-password allocation failed',stack:'secret-token at compose.js:123:4'};
vm.runInContext("recordStartupCheckpoint('context',failure)",sc);
assert.equal(startupPackets.at(-1).reason,'memory');assert.equal(startupPackets.at(-1).site,'compose.js:123:4');
assert.ok(!JSON.stringify(startupPackets).includes('secret-'));assert.equal(checkpoints.at(-1)[1],2);
vm.runInContext("recordStartupCheckpoint('ready')",sc);assert.equal(startupPackets.at(-1).error,'none');
wireFails=true;vm.runInContext("recordStartupCheckpoint('behavior',failure)",sc);assert.equal(checkpoints.at(-1)[0],4);
nativeFails=true;assert.doesNotThrow(()=>vm.runInContext("recordStartupCheckpoint('context',failure)",sc));
console.log('PASS: early unarmed startup evidence, disconnected checkpoint, bounded retry, error classification, private-data exclusion and diagnostic exception isolation');
