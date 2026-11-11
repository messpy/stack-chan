import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const projectRoot=process.env.STACKCHAN_PROJECTS_ROOT || path.resolve(here,'../../../../..');
const pcHub=process.env.STACKCHAN_PC_HUB || path.join(projectRoot,'repository/hub/index.html');
for(const [kind,source,end] of [['LAN',new URL('../../host/app/archive-web-page.js',import.meta.url),'async function messages(){'],['PC',pcHub,'async function refresh(){']]){
 test(kind+' delete requires confirmation, then refreshes; restore does not delete other data',async()=>{
  const page=fs.readFileSync(source,'utf8'),start=page.indexOf('const deletableMediaName=');const script=page.slice(start,page.indexOf(end,start));
  const elements=new Map(),calls=[];let confirmed=false,refreshes=0;
  const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:true,disabled:false,children:[],replaceChildren(){this.children=[]},append(...children){this.children.push(...children)}});return elements.get(id)};
  const request=async(path,args)=>{calls.push({path,args});return path.includes('/trash')?{items:[],total:0,next:null}:{};};
  const context=vm.createContext({el,$:el,node:()=>el('new'),document:{createElement:()=>el('new')},confirm:()=>confirmed,rpc:request,api:request,gallery:async()=>refreshes++,messages:async()=>refreshes++,refresh:async()=>refreshes++});vm.runInContext(script,context);
  await vm.runInContext("editMedia('delete','photo-1.jpg',{disabled:false})",context);assert.equal(calls.length,0);
  confirmed=true;await vm.runInContext("editMedia('delete','photo-1.jpg',{disabled:false})",context);assert.ok(calls.some(c=>c.path.endsWith('/media/delete')&&c.args.name==='photo-1.jpg'));assert.ok(refreshes>0);
  confirmed=false;await vm.runInContext("editMedia('restore','photo-1.jpg',{disabled:false})",context);assert.ok(calls.some(c=>c.path.endsWith('/media/restore')&&c.args.name==='photo-1.jpg'));
 });
}
