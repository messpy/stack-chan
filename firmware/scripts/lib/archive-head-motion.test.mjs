import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const ctx=vm.createContext({Object,Promise,String,Error,trace(){}})
const m=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/app/archive-head-motion.js',import.meta.url),'utf8'),{context:ctx})
await m.link(()=>new vm.SyntheticModule(['default'],function(){this.setExport('default',{set:fn=>fn()})},{context:ctx}));await m.evaluate()
const {headDirectionFromText,moveHead,HEAD_ROTATIONS,headMoveTool}=m.namespace
assert.equal(headDirectionFromText('上を向いて'),'up');assert.equal(headDirectionFromText('スタックちゃん、うえをむいてください。'),'up');assert.equal(headDirectionFromText('下を見て'),'down');assert.equal(headDirectionFromText('右向いて'),'right');assert.equal(headDirectionFromText('正面を向いてね'),'center')
for(const text of ['上を向いてと言った','昨日は上を見ていた','写真の上を見て','上の人は誰？','右'])assert.equal(headDirectionFromText(text),undefined)
const calls=[]
const robot={pose:{body:{rotation:{y:0,p:0,r:0}}},lookAway(){calls.push('stopGaze')},async setTorque(value){calls.push(['torque',value])},async setPose(pose){calls.push(['pose',pose.rotation]);this.pose.body=pose}}
await moveHead(robot,{direction:headDirectionFromText('上を向いて')});const up=robot.pose.body.rotation.p
await moveHead(robot,{direction:'down'});const down=robot.pose.body.rotation.p
assert.ok(up<down);assert.ok((down-up)*180/Math.PI>15,'up/down targets must be visibly separated within the safe range')
for(const target of Object.values(HEAD_ROTATIONS)){const degrees=-target.p*180/Math.PI;assert.ok(degrees>=5&&degrees<=85)}
const count=calls.length;await assert.rejects(moveHead(robot,{direction:'__proto__'}));assert.equal(calls.length,count)
assert.equal(headMoveTool.inputSchema.properties.direction.enum.length,5)
robot.setPose=async()=>{throw Error('bus failure')};await assert.rejects(moveHead(robot,{direction:'up'}));assert.equal(calls.at(-1)[1],false)
console.log('PASS: explicit voice commands reach motor actions, safe visible tilt range, invalid commands rejected, failure releases torque')

robot.setPose=async pose=>{calls.push(['pose',pose.rotation]);robot.pose.body=pose}
robot.setTorque=async value=>{calls.push(['torque',value]);if(value)throw Error('torque enable failed')}
await assert.rejects(moveHead(robot,{direction:'up'}),/torque enable failed/)
assert.equal(calls.at(-1)[1],false,'failed torque enable must attempt recovery')
robot.setTorque=async value=>{calls.push(['torque',value]);if(!value)throw Error('torque release failed')}
robot.setPose=async()=>{throw Error('servo bus failed')}
await assert.rejects(moveHead(robot,{direction:'up'}),/servo bus failed/,'cleanup failure must not hide original error')
await assert.rejects(moveHead(null,{direction:'left'}),/Motor control unavailable/)
console.log('PASS: missing motor, torque enable error and torque release failure handled')
