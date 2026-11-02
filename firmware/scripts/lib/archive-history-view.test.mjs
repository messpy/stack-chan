import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
let definition
class Node{constructor(data,props){Object.assign(this,props);this.data=data}}
class Button extends Node{constructor(data,props){super(data,props);this.label=data.label?{string:data.label}:null}content(name){return name==='label'?this.label:null}}
const context=vm.createContext({Container:Node,Label:Node,Text:Node,Skin:class{},Style:class{},ActionButton:Button,uiFont:()=>'',Date,Map})
const m=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/app/archive-history-ui.js',import.meta.url),'utf8'),{context})
await m.link(name=>{const values=name==='piu/MC'?{Container:Node,Label:Node,Text:Node,Skin:class{},Style:class{}}:name==='ui-controls'?{ActionButton:Button}:{uiFont:()=>''};return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v)},{context})});await m.evaluate()
const robot={ui:{miniApps:{register(value){definition=value}}}}
for(const items of [[],[{id:'one',role:'user',name:'けんと',text:'こんにちは',created:Date.now()}]]){
 m.namespace.startHistoryUI(robot,{people:()=>[],current:()=>null,read:()=>({items})})
 const view=definition.create();assert.ok(view.content.contents[0].content('label').string.startsWith('話す人:'))
 assert.ok(view.content.contents.some(c=>c.string===(items.length?'こんにちは':'会話履歴はありません')))
}
console.log('PASS: real history view constructs with empty and populated history when empty buttons have no label child')
