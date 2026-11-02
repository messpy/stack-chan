import fs from 'node:fs'
import vm from 'node:vm'
import {stripTypeScriptTypes} from 'node:module'
import assert from 'node:assert/strict'
const timers=[];let mode=255,output=false,direction=false
const expander={setDirection(pin,value){direction=value},setPullMode(){},setDriveMode(pin,openDrain){mode=openDrain?mode|1:mode&~1},digitalWrite(pin,value){output=value},getWriteValue(){return output},readRegister8(reg){return reg===19?mode:0}}
class Servo{setTorque(on,cb){cb?.()}readRawPosition(cb){cb({success:true,value:{position:500}})}getBusDiagnostics(){return {}}}
const ctx=vm.createContext({Map,Math,Number,Error,trace(){}})
const values={timer:{default:{set(fn){timers.push(fn);return 1},clear(){}}},'protocols/scservo':{default:Servo},'py32-io-expander':{tryGetSharedPY32IOExpander:()=>expander},'motion-controller':{motionDurationSecondsToMilliseconds:v=>v*1000}}
const cache=new Map()
async function load(name,path){
 if(cache.has(name))return cache.get(name)
 let m
 if(values[name]){const x=values[name];m=new vm.SyntheticModule(Object.keys(x),function(){for(const [k,v]of Object.entries(x))this.setExport(k,v)},{context:ctx})}
 else m=new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(path??'host/modules/motion/m5stackchan-servo.ts','utf8')),{context:ctx})
 cache.set(name,m);await m.link(n=>load(n));return m
}
const m=await load('driver','host/modules/motion/m5stackchan-servo-driver.ts');await m.evaluate()
const driver=new m.namespace.M5StackChanServoDriver()
driver.onAttached()
assert.equal(direction,true);assert.equal(output,true);assert.equal(mode&1,0,'enable must drive a high level rather than float in open-drain mode')
timers.shift()()
let result
driver.recoverPower(value=>result=value)
assert.equal(output,false)
timers.shift()();assert.equal(output,true);assert.equal(mode&1,0)
timers.shift()();assert.equal(result.pan.success,true);assert.equal(result.tilt.success,true)
driver.onDetached();assert.equal(output,false)
console.log('PASS: servo power drives enable, recovery cycles power and verifies both axes, detach disables power')
