import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import test from 'node:test';
const page=fs.readFileSync(new URL('../../host/app/archive-web-page.js',import.meta.url),'utf8');
const script=page.slice(page.indexOf('let cameraRunning='),page.indexOf('async function changeVolume('));
function fixture(){
 const elements=new Map(),calls=[],timers=new Map(),contexts=[],listeners=new Map();let serial=0,deferStart;
 const el=id=>{if(!elements.has(id))elements.set(id,{value:id==='monitorColor'?'#ff0000':'こんにちは',checked:id==='liveCamera',disabled:false,textContent:'',hidden:true,removeAttribute(key){delete this[key]}});return elements.get(id)};
 class Context{currentTime=0;destination={};closed=false;constructor(){contexts.push(this)}async resume(){calls.push({resume:true})}async close(){this.closed=true}createBuffer(channels,frames){return{getChannelData:()=>new Float32Array(frames)}}createBufferSource(){return{connect(){},disconnect(){},start(){},stop(){}}}}
 const context=vm.createContext({el,document:{hidden:false,addEventListener:(name,fn)=>listeners.set("document:"+name,fn)},window:{AudioContext:Context,addEventListener:(name,fn)=>listeners.set(name,fn)},URL:{createObjectURL:()=>`blob:${serial++}`,revokeObjectURL(){}},AbortController,DataView,Set,encodeURIComponent,console,setTimeout:(fn,ms)=>(timers.set(++serial,{fn,ms}),serial),setInterval:(fn,ms)=>(timers.set(++serial,{fn,ms}),serial),clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id),rpc:async(op,args)=>{calls.push({op,args});if(op==='/monitor/start'){if(deferStart)await deferStart;return{id:'test-session'}}return{}},fetch:async(url,options)=>{calls.push({url,options});return{ok:true,blob:async()=>({}),arrayBuffer:async()=>new Int16Array([1000,-1000]).buffer}}});
 vm.runInContext(script,context);return{el,calls,context,timers,contexts,listeners,defer(){let resolve;deferStart=new Promise(r=>resolve=r);return resolve}};
}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
for(const [camera,audio] of [[true,false],[false,true],[true,true]])test('LIVE selection camera='+camera+' audio='+audio,async()=>{
 const f=fixture();f.el('liveCamera').checked=camera;f.el('liveAudio').checked=audio;await f.el('liveStart').onclick();await flush();
 assert.equal(f.calls.some(c=>c.url==='/camera/frame?session=test-session'),camera);assert.equal(f.el('cameraPreview').hidden,!camera);assert.equal(f.calls.some(c=>c.url==='/monitor/audio?session=test-session'),audio);
 if(audio)assert.ok(f.calls.findIndex(c=>c.resume)<f.calls.findIndex(c=>c.op==='/monitor/start'));
 await f.el('monitorEnd').onclick();assert.equal(f.el('cameraPreview').hidden,true);assert.ok(f.contexts.every(c=>c.closed));assert.equal(f.timers.size,0);
});
test('no selection does not start hardware',async()=>{
 const f=fixture();f.el('liveCamera').checked=false;await f.el('liveStart').onclick();assert.equal(f.calls.length,0);assert.match(f.el('liveState').textContent,/チェック/);
});
test('LIVE change stops old audio and starts only selected camera',async()=>{
 const f=fixture();f.el('liveCamera').checked=false;f.el('liveAudio').checked=true;await f.el('liveStart').onclick();await flush();
 f.el('liveCamera').checked=true;f.el('liveAudio').checked=false;await f.el('liveStart').onclick();await flush();assert.ok(f.contexts[0].closed);assert.ok(f.calls.some(c=>c.op==='/monitor/audio'&&c.args.enabled===false));assert.ok(f.calls.some(c=>c.url?.startsWith('/camera/frame')));await f.el('liveStop').onclick();assert.equal(f.el('cameraPreview').hidden,true);await f.el('monitorEnd').onclick();
});
test('duplicate starts and cancelling an in-flight start cannot leave the mic running',async()=>{
 const f=fixture(),resolve=f.defer();f.el('liveAudio').checked=true;
 const first=f.el('liveStart').onclick(),second=f.el('liveStart').onclick();await flush();await f.el('liveStop').onclick();resolve();await Promise.all([first,second]);await flush();assert.equal(f.calls.filter(c=>c.op==='/monitor/start').length,1);assert.equal(f.calls.filter(c=>c.op==='/monitor/audio'&&c.args.enabled).length,0);assert.ok(f.contexts.every(c=>c.closed));await f.el('monitorEnd').onclick();
});
test('subtitle checkbox is forwarded; speech caption is optional',async()=>{
 const f=fixture();await f.el('monitorSpeak').onclick();assert.equal(f.el('speechCaption').hidden,true);let commands=f.calls.filter(c=>c.op==='/monitor/command');assert.equal(commands[0].args.arguments.subtitles,false);
 f.el('monitorSubtitles').checked=true;await f.el('monitorSpeak').onclick();assert.equal(f.el('speechCaption').hidden,false);assert.equal(f.el('speechCaption').textContent,'こんにちは');commands=f.calls.filter(c=>c.op==='/monitor/command');assert.equal(commands[1].args.arguments.subtitles,true);await f.el('monitorEnd').onclick();assert.equal(f.el('speechCaption').hidden,true);
});

const pointer=(id=1)=>({pointerId:id,button:0,preventDefault(){},currentTarget:{setPointerCapture(){}}});
test('camera stays live during hold; release sends a newer stop and late pulse does nothing',async()=>{
 const f=fixture();await f.el('liveStart').onclick();await f.el('pose-up').onpointerdown(pointer());await flush();
 const begin=f.calls.find(c=>c.args?.action==='pose_hold'&&c.args.arguments.held);assert.equal(begin.args.arguments.direction,'up');
 assert.equal(vm.runInContext('cameraRunning',f.context),true);
 const pulse=[...f.timers.values()].find(t=>t.ms===250).fn;await pulse();await flush();
 await f.el('pose-up').onpointerup(pointer());const stop=f.calls.filter(c=>c.args?.action==='pose_hold').at(-1);assert.equal(stop.args.arguments.held,false);assert.ok(stop.args.arguments.sequence>begin.args.arguments.sequence);
 const count=f.calls.length;await pulse();assert.equal(f.calls.length,count);await f.el('monitorEnd').onclick();assert.equal(f.timers.size,0);
});
test('release before session start prevents a delayed motor command',async()=>{
 const f=fixture(),ready=f.defer();const pressing=f.el('pose-right').onpointerdown(pointer());await flush();await f.el('pose-right').onpointercancel(pointer());ready();await pressing;await flush();
 assert.equal(f.calls.some(c=>c.args?.action==='pose_hold'),false);await f.el('monitorEnd').onclick();
});
test('focus loss and hidden page stop the held direction; keyboard hold also stops',async()=>{
 const f=fixture();await f.el('pose-left').onpointerdown(pointer());await flush();f.listeners.get('blur')();await flush();assert.equal(f.calls.filter(c=>c.args?.action==='pose_hold').at(-1).args.arguments.held,false);
 f.el('pose-down').onkeydown({key:' ',repeat:false,preventDefault(){}});await flush();f.el('pose-down').onkeyup({key:' ',preventDefault(){}});await flush();assert.equal(f.calls.filter(c=>c.args?.action==='pose_hold').at(-1).args.arguments.held,false);
 await f.el('pose-up').onpointerdown(pointer());await flush();f.context.document.hidden=true;f.listeners.get('document:visibilitychange')();await flush();assert.equal(f.timers.size,0);assert.ok(f.calls.some(c=>c.url==='/rpc'));
});

test('stale camera frames stop held motion even if the command link still works',async()=>{
 const f=fixture();await f.el('liveStart').onclick();await f.el('pose-right').onpointerdown(pointer());await flush();
 vm.runInContext('cameraLastFrameAt=Date.now()-5000',f.context);const pulse=[...f.timers.values()].find(t=>t.ms===250).fn;await pulse();await flush();
 assert.equal(f.calls.filter(c=>c.args?.action==='pose_hold').at(-1).args.arguments.held,false);assert.match(f.el('headState').textContent,/映像/);await f.el('monitorEnd').onclick();
});
