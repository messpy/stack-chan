import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {test} from 'node:test'

class Node {
 constructor(_data={},options={}){Object.assign(this,options);this.children=options.contents||[]}
 add(child){this.children.push(child)}
 empty(){this.children=[]}
}
const source=(file)=>readFileSync(new URL('../../host/app/'+file,import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')

test('daily AI scheduler is persisted; manual override remains until next boundary',()=>{
 let now=Date.UTC(2026,10,8,0,5) // 09:05 JST
 class FakeDate extends Date {static now(){return now}}
 const timers=[];
 const settings={aiSchedule:{enabled:false,onMinute:480,offMinute:1380}};
 const modeCalls=[];
 let on=false,registration;
 const robot={ui:{miniApps:{register(def){registration=def}},application:{behavior:{onMiniAppBack(){}}}}};
 const context=vm.createContext({
  Date:FakeDate,Number,Object,String,Math,Timer:{
   set(fn,ms){timers.push({fn,ms});return timers.length},
   repeat(fn,ms){timers.push({fn,ms});return timers.length}
  },Time:{timezone:9*3600},getSettings:()=>settings,changeSettings:fn=>fn(settings),
  Container:Node,Text:Node,Skin:class{},Style:class{},uiFont:()=>'',trace:()=>{},
  createUIButton:(data,methods,layout)=>({...data,...layout,press:()=>methods[data.method](data.args)})
 });
 vm.runInContext(source('archive-chat-schedule-policy.js')+'\n'+source('archive-chat-schedule.js'),context);
 context.robot=robot;
 context.actions={status:()=>({enabled:on}),mode:value=>{on=value;modeCalls.push(value)}};
 vm.runInContext('startAISchedule(robot,actions)',context);
 assert.equal(registration.id,'archive-ai-schedule');
 const page=registration.create();
 const toggle=page.content.children.find(b=>b.method==='toggle');
 toggle.press();
 const save=page.content.children.find(b=>b.method==='save');
 save.press();
 assert.equal(settings.aiSchedule.enabled,true);
 assert.deepEqual(modeCalls,[true]);
 on=false; // manual OFF during the 08:00-23:00 ON window
 timers.find(t=>t.ms===15000).fn();
 assert.deepEqual(modeCalls,[true]); // no reassertion within the same interval
 now=Date.UTC(2026,10,8,14,0); // 23:00 JST
 timers.find(t=>t.ms===15000).fn();
 assert.deepEqual(modeCalls,[true]); // already OFF: no redundant write
 now=Date.UTC(2026,10,8,23,0); // next 08:00 JST
 timers.find(t=>t.ms===15000).fn();
 assert.deepEqual(modeCalls,[true,true]);
});
test('invalid system clock never enables AI automatically',()=>{
 let registration;
 const context=vm.createContext({
  Date:class extends Date {static now(){return 0}},Number,Object,String,Math,
  Timer:{set(){},repeat(){}},Time:{timezone:9*3600},
  Container:Node,Text:Node,Skin:class{},Style:class{},uiFont:()=>'',trace:()=>{},
  createUIButton:(data,methods,layout)=>({...data,...layout,press:()=>methods[data.method](data.args)}),
  getSettings:()=>({aiSchedule:{enabled:true,onMinute:480,offMinute:1380}}),
  changeSettings(){throw Error('must not write')}
 });
 vm.runInContext(source('archive-chat-schedule-policy.js')+'\n'+source('archive-chat-schedule.js'),context);
 context.robot={ui:{miniApps:{register(def){registration=def}},application:{behavior:{onMiniAppBack(){}}}}};
 context.actions={status:()=>({enabled:false}),mode:()=>{throw Error('clock not ready')}};
 vm.runInContext('startAISchedule(robot,actions)',context);
 assert.equal(registration.id,'archive-ai-schedule');
});
