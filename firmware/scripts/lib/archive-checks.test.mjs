import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const c=vm.createContext({trace(){}});vm.runInContext(fs.readFileSync(new URL('../../host/app/archive-checks.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,''),c);
const order=[];c.actions={prepare(){},async test(id,report,stopped){order.push(id);report(id);if(id==='led')throw Error('failed');return id+' result';}};
vm.runInContext('runner=createCheckRunner(actions)',c);const result=await vm.runInContext("runner.run('all')",c);assert.deepEqual(order,['emotion','servo','led','recognition','audio']);assert.equal(result.running,false);assert.equal(result.results[2].state,'failed');assert.equal(result.results[4].state,'done');
c.actions.test=async(id)=>{order.push(id);vm.runInContext('runner.stop()',c);};order.length=0;const stopped=await vm.runInContext("runner.run('all')",c);assert.deepEqual(order,['emotion']);assert.equal(stopped.results[0].state,'stopped');
let finish;c.actions.test=()=>new Promise(resolve=>finish=resolve);const pending=vm.runInContext("runner.run('servo')",c);await assert.rejects(()=>vm.runInContext("runner.run('led')",c));finish('ok');await pending;
const snapshot=vm.runInContext('runner.status()',c);snapshot.results[0].state='changed';assert.equal(vm.runInContext('runner.status().results[0].state',c),'done');
console.log('PASS: sequential diagnostics, failure isolation, stop prevents later steps, concurrent start rejected, result snapshots isolated');
class Node{constructor(data,o={}){this.data=data;Object.assign(this,o);this.children=[...(o.contents||[])];}add(n){this.children.push(n);}}
const apps={},effects=[];let closed=0,face=0,removed=0;
Object.assign(c,{Container:Node,Label:Node,CheckText:Node,ActionButton:Node,Skin:class{},Style:class{},uiFont:()=>'',Timer:{set:fn=>queueMicrotask(fn)}});
c.robot={ui:{miniApps:{register:def=>apps[def.id]=def},showFace:()=>face++,addEffect:bar=>effects.push(bar),removeEffect:()=>removed++,application:{behavior:{launchMiniApp:id=>!!apps[id]}}},hideBalloon(){}};
c.actions={prepare(){},async test(){return '確認できました';}};
vm.runInContext('startChecks(robot,actions)',c);
const view=apps['archive-checks'].create({close:()=>closed++});assert.equal(view.content.children.length,9);
view.content.children[1].data.onTap();await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,1);assert.equal(face,1);assert.equal(effects.length,1);assert.equal(effects[0].height,74);assert.equal(effects[0].children[0].string,'確認が終わりました');effects[0].children[2].data.onTap();assert.equal(removed,1);
console.log('PASS: test picker closes before restoring face, bottom progress and stop/result controls, clean return');
