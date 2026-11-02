import fs from 'node:fs'
import vm from 'node:vm'
import {stripTypeScriptTypes} from 'node:module'
import assert from 'node:assert/strict'
const timers=new Map();const delays=[];let token=0,port
const timer={set(fn,delay){delays.push(delay);const id=++token;timers.set(id,fn);return id},clear(id){timers.delete(id)}}
class Serial{
 constructor(opts){port=this;this.options=opts;this.format=opts.format;this.queue=[]}
 read(){return this.queue.shift()}
 write(){}
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
const servo=new m.namespace.default({id:1,awaitWriteResponse:false,serial:{transmit:6,receive:7,port:1,baud:1000000}})
const reply=[255,255,1,4,0,1,220,29] // raw position 476
for(const noise of [[12,55,255,255,1,255],[255,255,1,0],[255,255,255,255],[0,255]]){
 let result
 servo.readRawPosition(value=>{result=value})
 port.feed(noise)
 port.feed(reply.slice(0,3));port.feed(reply.slice(3))
 assert.equal(result?.success,true,`recover from noise ${noise}`)
 assert.equal(result.value.position,476)
}
assert.ok(servo.getBusDiagnostics().invalidPackets>0)
console.log('PASS: actual SCServo parser recovers from impossible lengths, repeated headers and split status packets')

const slowServo=new m.namespace.default({id:2,awaitWriteResponse:false,responseTimeout:1500,serial:{transmit:6,receive:7,port:1,baud:1000000}})
slowServo.readRawPosition(()=>{})
assert.ok(delays.includes(1500),'configured response deadline must be used rather than the default')
