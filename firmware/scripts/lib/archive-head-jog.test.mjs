import fs from 'node:fs'
import assert from 'node:assert/strict'
const {createHeadJog,HEAD_JOG_LIMITS}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-head-jog.js',import.meta.url))).toString('base64'))
function fixture(){
 let clock=0,serial=0;const timers=new Map(),moves=[],torques=[]
 const robot={pose:{body:{rotation:{y:0,p:-.25,r:0}}},lookAway(){},async setTorque(value){torques.push(value)},async setPose(pose){moves.push({...pose.rotation})}}
 const jog=createHeadJog(robot,{now:()=>clock,repeat(fn){timers.set(++serial,fn);return serial},cancel:id=>timers.delete(id)})
 jog.seed(robot.pose.body.rotation)
 return{jog,robot,moves,torques,timers,async advance(ms){for(let i=0;i<ms;i+=50){clock+=Math.min(50,ms-i);for(const fn of timers.values())fn();await new Promise(setImmediate)}},async held(direction,ms,sequence=1){jog.hold({direction,held:true,sequence});for(let i=0;i<ms;i+=50){if(i&&i%250===0)jog.hold({direction,held:true,sequence});await this.advance(Math.min(50,ms-i))}}}
}
const short=fixture();await short.held('right',250);const small=Math.abs(short.jog.state().rotation.y)
const long=fixture();await long.held('right',1000);assert.ok(Math.abs(long.jog.state().rotation.y)>small*3)
long.jog.hold({held:false,sequence:2});const stopped=long.moves.length;await long.advance(500);assert.equal(long.moves.length,stopped)
long.jog.hold({held:true,sequence:1,direction:'right'});await long.advance(500);assert.equal(long.moves.length,stopped,'late renewal after release cannot restart motion')
const lost=fixture();lost.jog.hold({held:true,sequence:1,direction:'up'});await lost.advance(1500);assert.equal(lost.jog.state().moving,false);const lostCount=lost.moves.length;await lost.advance(1000);assert.equal(lost.moves.length,lostCount)
for(const direction of ['left','right','up','down']){
 const f=fixture();await f.held(direction,10000)
 const {rotation,atLimit}=f.jog.state();assert.equal(atLimit,true)
 assert.ok(rotation.y>=HEAD_JOG_LIMITS.minY&&rotation.y<=HEAD_JOG_LIMITS.maxY);assert.ok(rotation.p>=HEAD_JOG_LIMITS.minP&&rotation.p<=HEAD_JOG_LIMITS.maxP)
 const count=f.moves.length;await f.held(direction,1000);assert.equal(f.moves.length,count,'no repeated writes at endpoint');await f.jog.close();assert.equal(f.timers.size,0)
}
const initial=fixture();initial.jog.seed({y:1.3,p:-.25,r:0});await initial.held('right',50);assert.ok(initial.jog.state().rotation.y>1.2,'return from outside manual limit must not jump to endpoint')
const pending=fixture();let release;pending.robot.setTorque=()=>new Promise(r=>release=r);pending.jog.hold({held:true,sequence:1,direction:'up'});await pending.advance(50);const closing=pending.jog.close();release();await closing;assert.equal(pending.moves.length,0,'closing while torque is pending must not issue late movement')
assert.throws(()=>short.jog.hold({held:true,sequence:2,direction:'__proto__'}));await short.jog.close();await long.jog.close();await lost.jog.close();await initial.jog.close()
console.log('PASS: hold duration controls travel, release and stale messages stop, link loss stops, all endpoints clamp without repeated writes, closing cancels late movement')
