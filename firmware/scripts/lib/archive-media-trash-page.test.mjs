import fs from 'node:fs';import {homedir} from 'node:os';import {join} from 'node:path';import vm from 'node:vm';import assert from 'node:assert/strict';import test from 'node:test';
for(const [kind,path,end] of [['LAN','../../host/app/archive-web-page.js','async function messages(){'],['PC','index.html','async function refresh(){']]){
 test(kind+' delete requires confirmation, then refreshes; restore does not delete other data',async()=>{
  // Hub is a separate checkout, not a sibling of every firmware worktree.
  const source=kind==='PC'?join(process.env.STACKCHAN_HUB_ROOT||join(homedir(),'work','hub'),path):new URL(path,import.meta.url);
  if(!fs.existsSync(source))throw new Error('Page fixture missing; set STACKCHAN_HUB_ROOT to the existing Hub checkout containing index.html');
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
