import fs from 'node:fs'
import vm from 'node:vm'
import {stripTypeScriptTypes} from 'node:module'
import assert from 'node:assert/strict'
const timers=new Map();const delays=[];const writes=[];let token=0,port,clock=0
const timer={set(fn,delay){delays.push(delay);const id=++token;timers.set(id,{fn,at:clock+delay});return id},clear(id){timers.delete(id)}}
class Serial{
 constructor(opts){port=this;this.options=opts;this.format=opts.format;this.queue=[]}
 read(){return this.queue.shift()}
 write(bytes){writes.push({at:clock,bytes:Array.from(bytes)})}
 feed(values){this.queue.push(...values);this.options.onReadable.call(this,values.length)}
}
const ctx=vm.createContext({Uint8Array,Map,Error,Math,Number,Date,trace(){}})
const files={'single-wait-slot':'host/modules/motion/internal/single-wait-slot.ts','servo-bus-queue':'host/modules/motion/internal/servo-bus-queue.ts','servo-command-error':'host/modules/motion/internal/servo-command-error.ts','payload-buffer':'host/modules/motion/payload-buffer.ts'}
const stubs={'embedded:io/serial':{default:Serial},'mc/config':{default:{}},timer:{default:timer}}
const cache=new Map()
async function load(name,file){
 if(cache.has(name))return cache.get(name)
 let m
 if(stubs[name]){const values=stubs[name];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context:ctx})}
 else m=new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file??files[name],'utf8')),{context:ctx,identifier:name})
 cache.set(name,m);await m.link(dep=>load(dep));return m
}
const m=await load('scservo','host/modules/motion/protocols/scservo.ts');await m.evaluate()

function advance(ms){const end=clock+ms;let guard=0;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert.ok(++guard<1000);clock=next[1].at;timers.delete(next[0]);next[1].fn()}clock=end}
const options={awaitWriteResponse:false,responseTimeout:20,serial:{transmit:6,receive:7,port:1,baud:1000000}};
const pan=new m.namespace.default({...options,id:1}),tilt=new m.namespace.default({...options,id:2});
pan.setRawPositionInTime(500,300);tilt.setRawPositionInTime(600,300);
assert.equal(writes.length,1);advance(4);assert.equal(writes.length,1);advance(1);assert.equal(writes.length,2);
assert.deepEqual(writes.map(w=>w.bytes[2]),[1,2]);
for(const w of writes){assert.equal(w.bytes.length,13);assert.deepEqual(w.bytes.slice(10,12),[0,0])}
advance(5);let first,second;
pan.readRawPosition(result=>first=result);tilt.readRawPosition(result=>second=result);
assert.equal(writes.length,3);advance(19);assert.equal(writes.length,3);advance(1);assert.equal(first.success,false);assert.equal(writes.length,4);
const reply=[255,255,2,4,0,1,220];reply.push((~reply.slice(2).reduce((a,b)=>a+b,0))&255);port.feed(reply);
assert.equal(second.success,true);assert.equal(second.value.position,476);
advance(10);pan.setRawPosition(450);advance(5);assert.equal(writes.length,5);
console.log('PASS: shared servo bus serializes both axes, leaves turnaround time, holds reads until timeout/reply, continues afterward and clears prior speed');
