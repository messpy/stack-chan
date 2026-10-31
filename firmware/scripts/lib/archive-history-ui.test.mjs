import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let definition,reads=[],failed=false;
class Node{constructor(data,options={}){Object.assign(this,options);this.data=data;this.children=options.contents||[];this.label={string:data?.label||''};}content(){return this.label;}}
const rows=Array.from({length:12},(_,i)=>({id:String(i),role:i%2?'assistant':'user',name:'アオ',partner:'アオ',created:1700000000000,text:i===0?Array.from({length:100},(_,n)=>'文章'+n+'です。').join(''):'発言'+i}));
const context=vm.createContext({Container:Node,Label:Node,Text:Node,Skin:class{},Style:class{},ActionButton:Node,uiFont:()=>''});
vm.runInContext(fs.readFileSync(new URL('../../host/app/archive-history-ui.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,''),context);
context.robot={ui:{miniApps:{register:d=>definition=d}}};context.actions={people:()=>[{id:'alice',name:'アオ'}],current:()=>({id:'alice'}),read:args=>{reads.push(args);if(failed)throw Error('SD');return {items:rows.slice(0,args.limit),hasMore:true}}};
vm.runInContext('startHistoryUI(robot,actions)',context);assert.equal(definition.hidden,undefined);
const screen=definition.create().content,controls=screen.children;
assert.equal(reads[0].user_id,'alice');assert.ok(controls[2].string.includes('アオ'));assert.equal(controls[3].string.split('\n').length,7);
const before=controls[3].string;controls[6].data.onTap();assert.notEqual(controls[3].string,before);
for(let i=0;i<30;i++)controls[8].data.onTap();assert.equal(reads.length,1);assert.equal(controls[3].string,'発言9');assert.equal(controls[8].active,false);
controls[7].data.onTap();assert.equal(controls[3].string,'発言8');
controls[0].data.onTap();assert.equal(reads.at(-1).user_id,null);
failed=true;controls[1].data.onTap();assert.ok(controls[3].string.includes('読めません'));
const pages=vm.runInContext("historyPages('あいうえお'.repeat(500))",context);assert.equal(pages.join('').replace(/\n/g,''),'あいうえお'.repeat(500));assert.ok(pages.every(p=>p.split('\n').length<=7));
assert.ok(controls.filter(c=>c.data?.onTap).every(c=>c.top+c.height<=196));
console.log('PASS: history mini app, current/all filter, bounded message/text paging, error display, text preserved and buttons fit');
