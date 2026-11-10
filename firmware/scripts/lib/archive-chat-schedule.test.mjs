import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {test} from 'node:test'

const source=readFileSync(new URL('../../host/app/archive-chat-schedule-policy.js',import.meta.url),'utf8')
 .replace(/^export /gm,'')+'\nthis.policy={normalizeAISchedule,validAISchedule,scheduleBoundary};'
const context=vm.createContext({Date,Number,Object,String})
vm.runInContext(source,context)
const {normalizeAISchedule,validAISchedule,scheduleBoundary}=context.policy
const at=(year,month,day,hour,minute)=>Date.UTC(year,month-1,day,hour-9,minute)

test('AI schedule starts disabled and rejects invalid/equal times',()=>{
 assert.equal(normalizeAISchedule(null).enabled,false)
 assert.equal(validAISchedule({enabled:true,onMinute:480,offMinute:480}),false)
 assert.equal(validAISchedule({enabled:true,onMinute:-1,offMinute:600}),false)
 assert.equal(validAISchedule({enabled:true,onMinute:480,offMinute:1380}),true)
})
test('Japan daily switch and midnight wrap',()=>{
 const schedule={enabled:true,onMinute:480,offMinute:1380}
 assert.equal(scheduleBoundary(at(2026,11,8,7,59),schedule).enabled,false)
 assert.equal(scheduleBoundary(at(2026,11,8,8,0),schedule).enabled,true)
 assert.equal(scheduleBoundary(at(2026,11,8,23,0),schedule).enabled,false)
 assert.equal(scheduleBoundary(at(2026,11,9,0,5),schedule).enabled,false)
})
test('overnight ON interval and local timezone offsets',()=>{
 const schedule={enabled:true,onMinute:1380,offMinute:480}
 assert.equal(scheduleBoundary(at(2026,11,8,23,1),schedule).enabled,true)
 assert.equal(scheduleBoundary(at(2026,11,9,0,0),schedule).enabled,true)
 assert.equal(scheduleBoundary(at(2026,11,9,8,0),schedule).enabled,false)
 assert.equal(scheduleBoundary(Date.UTC(2026,10,8,8,0),{enabled:true,onMinute:480,offMinute:1380},0).enabled,true)
})
test('untrusted clock or disabled schedules never trigger',()=>{
 assert.equal(scheduleBoundary(0,{enabled:true,onMinute:480,offMinute:1380}),null)
 assert.equal(scheduleBoundary(at(2026,11,8,12,0),{enabled:false,onMinute:480,offMinute:1380}),null)
 assert.equal(scheduleBoundary(at(2026,11,8,12,0),{enabled:true,onMinute:480,offMinute:1380},NaN),null)
})
