import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const lan=fs.readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8');
const web=fs.readFileSync(new URL('../../host/app/archive-web.js',import.meta.url),'utf8');

test('USB command gate rejects null JSON, missing credentials, arrays and invalid RPC envelopes',()=>{
 const start=lan.indexOf('export function validArchiveUSBRequest(request,expectedToken){');
 const end=lan.indexOf('\n}',start);
 assert.ok(start>=0&&end>start);
 const code=lan.slice(start,end+2).replace('export function','function');
 const valid=vm.runInNewContext(code+'\nvalidArchiveUSBRequest',{Number,Array,Object});
 const token='PRIVATE_TEST_KEY';
 for(const row of [null,false,12,'text',[],{},{
  id:1,token:'wrong',op:'/status'},{
  id:1,token,op:''},{
  id:1,token,op:'/status',args:[]},{
  id:1,token,op:'/status',args:null},{
  id:1,token,op:'/status',args:{},length:65},{
  id:1.5,token,op:'/status'},{
  id:-1,token,op:'/status'},{
  id:1,token,op:'a'.repeat(65)}])
  assert.equal(valid(row,token),false,JSON.stringify(row));
 assert.equal(valid({id:1,token,op:'/status'},token),true);
 assert.equal(valid({id:0,token,op:'/settings/status',args:{}},token),true);
 assert.match(lan,/if\(!validArchiveUSBRequest\(request,token\)\)return/);
});

test('Web server route-registration failures do not falsely report server readiness',()=>{
 const start=web.indexOf('function startServer(){');
 const end=web.indexOf('\nexport function startWeb(',start);
 assert.ok(start>=0&&end>start);
 const source=web.slice(start,end);
 let fail=true,closed=0,created=[];
 class HTTP {
  constructor(){this.paths=[];created.push(this);}
  get(path,handler){if(fail)throw Error('bind failed');this.paths.push(['GET',path]);}
  post(path,handler){this.paths.push(['POST',path]);}
  close(){closed++;}
 }
 const context=vm.createContext({
  server:undefined,HttpServerService:HTTP,ArchiveHTTPServer:class {},
  protect:fn=>fn,Response:class {},trace(){},access:'test-key',
  PAGE:'test-page',mediaName:()=>true,faceEditorAsset:()=>'',actions:{},
 });
 const startServer=vm.runInContext(source+'\nstartServer',context);
 assert.throws(()=>startServer(),/bind failed/);
 assert.equal(context.server,undefined);
 assert.equal(closed,1);
 fail=false;
 startServer();
 assert.equal(context.server,created.at(-1));
 assert.ok(context.server.paths.some(([method,path])=>method==='GET'&&path==='/diagnostics'));
 assert.ok(context.server.paths.some(([method,path])=>method==='POST'&&path==='/rpc'));
 assert.equal(closed,1);
});
