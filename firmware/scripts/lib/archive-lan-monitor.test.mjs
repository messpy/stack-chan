import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const timerURL='data:text/javascript;base64,'+Buffer.from('export default {set: fn => {fn();return 1}}').toString('base64');
const headURL='data:text/javascript;base64,'+Buffer.from('const trace=()=>{};\n'+fs.readFileSync(new URL('../../host/app/archive-head-motion.js',import.meta.url),'utf8').replace("'timer'",JSON.stringify(timerURL))).toString('base64');
const jogURL='data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-head-jog.js',import.meta.url),'utf8')).toString('base64');
const {createLANMonitor}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-lan-monitor.js',import.meta.url),'utf8').replace("'archive-head-motion'",JSON.stringify(headURL)).replace("'archive-head-jog'",JSON.stringify(jogURL))).toString('base64'));
function setup(){
 let time=0,tick,claimed=0,released=0,frameClosed=0,cameraStopped=0,speech,failInput=false;
 const inputs=[],calls=[];
 const robot={hideBalloon:()=>calls.push(['hideBalloon']),showBalloon:(...args)=>calls.push(['showBalloon',...args]),led:{head:{}},pose:{body:{rotation:{y:0,p:0,r:0}}},lookAway:()=>calls.push('lookAway'),setTorque:async value=>calls.push(['torque',value]),setPose:async(pose,duration)=>calls.push(['pose',pose.rotation,duration]),lightOff:name=>calls.push(['off',name]),lightOn:(...args)=>calls.push(['color',...args]),lightRainbow:name=>calls.push(['rainbow',name]),camera:{capture:async()=>({buffer:new ArrayBuffer(2),width:1,height:1,imageType:'rgb565le',close(){frameClosed++}}),stop(){cameraStopped++}}};
 const monitor=createLANMonitor({robot,claim(){claimed++},release(){released++},now:()=>time,repeat:fn=>(tick=fn,1),cancel:()=>{},token:()=>`session-${claimed}`,createInput(options){const input={channels:2,closed:false,start(){if(failInput)throw Error('microphone start failure')},close(){this.closed=true},read(){return this.chunk},push(chunk){this.chunk=chunk;options.onReadable()}};inputs.push(input);return input},convertPCM:raw=>({buffer:raw}),speak:async (text,options)=>{calls.push(['speak',text,options]);if(speech)await speech},jpeg:()=>new Uint8Array([255,216,255,217]).buffer});
 return {monitor,robot,inputs,calls,get released(){return released},get frameClosed(){return frameClosed},get cameraStopped(){return cameraStopped},advance(ms){time+=ms;tick()},failInput(value){failInput=value},deferSpeech(){let resolve;speech=new Promise(r=>resolve=r);return resolve}};
}
test('exclusive session, identity check, PCM bounded latest audio, concurrent camera',async()=>{
 const f=setup(),id=f.monitor.start().id;
 assert.throws(()=>f.monitor.start());assert.throws(()=>f.monitor.status('other'));
 f.monitor.audio(id,true);const input=f.inputs[0];
 for(let i=0;i<12;i++)input.push(new Uint8Array(4000).fill(i).buffer);
 const audio=new Uint8Array(f.monitor.readAudio(id));assert.equal(audio.length,32000);assert.equal(audio[0],4);assert.equal(audio.at(-1),11);
 assert.equal(f.monitor.readAudio(id).byteLength,0);
 assert.equal((await f.monitor.frame(id)).byteLength,4);assert.equal(f.frameClosed,1);assert.equal(f.cameraStopped,1);assert.equal(input.closed,false);
 await f.monitor.stop(id);assert.equal(input.closed,true);assert.equal(f.released,1);assert.equal(f.monitor.active,false);
});
test('direction, LED and validation before hardware access',async()=>{
 const f=setup(),id=f.monitor.start().id;
 for(const direction of ['up','down','left','right','center'])await f.monitor.command(id,'pose',{direction});
 assert.equal(f.calls.filter(c=>c[0]==='pose').length,5);
 for(const rotation of f.calls.filter(c=>c[0]==='pose').map(c=>c[1]))assert.ok(Math.abs(rotation.y)<=.3&&-rotation.p*180/Math.PI>=5&&-rotation.p*180/Math.PI<=85);
 await f.monitor.command(id,'led',{mode:'color',color:'#ff8000'});assert.deepEqual(f.calls.at(-1),['color','head',63,32,0]);
 await f.monitor.command(id,'led',{mode:'rainbow'});assert.deepEqual(f.calls.at(-1),['rainbow','head']);
 const count=f.calls.length;
 await assert.rejects(f.monitor.command(id,'pose',{direction:'__proto__'}));await assert.rejects(f.monitor.command(id,'led',{mode:'color',color:'red'}));await assert.rejects(f.monitor.command(id,'speak',{text:'x'.repeat(201)}));assert.equal(f.calls.length,count);
 await f.monitor.stop(id);assert.deepEqual(f.calls.at(-1),['torque',false]);
});
test('speech releases microphone and restores it, stop waits for speech without reopening',async()=>{
 const f=setup(),id=f.monitor.start().id;f.monitor.audio(id,true);
 let resolve=f.deferSpeech();const speaking=f.monitor.command(id,'speak',{text:'こんにちは'});
 assert.equal(f.inputs[0].closed,true);await assert.rejects(f.monitor.command(id,'pose',{direction:'up'}));
 resolve();await speaking;assert.equal(f.inputs.length,2);assert.equal(f.inputs[1].closed,false);
 resolve=f.deferSpeech();const again=f.monitor.command(id,'speak',{text:'テスト'});const stopping=f.monitor.stop(id);
 assert.equal(f.released,0);resolve();await again;await stopping;assert.equal(f.inputs.length,2);assert.equal(f.released,1);
});
test('lease loss stops microphone and releases robot; old session cannot access new one',async()=>{
 const f=setup(),id=f.monitor.start().id;f.monitor.audio(id,true);f.advance(12001);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.monitor.active,false);assert.equal(f.inputs[0].closed,true);assert.equal(f.released,1);
 const next=f.monitor.start().id;assert.notEqual(next,id);await assert.rejects(f.monitor.stop(id));assert.throws(()=>f.monitor.readAudio(id));await f.monitor.stop(next);
});
test('capture failure closes camera and next capture can succeed',async()=>{
 const f=setup(),id=f.monitor.start().id,original=f.robot.camera.capture;
 f.robot.camera.capture=()=>{throw Error('sensor failure')};await assert.rejects(f.monitor.frame(id),/sensor failure/);assert.equal(f.cameraStopped,1);
 f.robot.camera.capture=original;assert.equal((await f.monitor.frame(id)).byteLength,4);await f.monitor.stop(id);
});
test('microphone start failure leaves session usable',async()=>{
 const f=setup(),id=f.monitor.start().id;f.failInput(true);assert.throws(()=>f.monitor.audio(id,true),/microphone start failure/);assert.equal(f.inputs[0].closed,true);assert.equal(f.monitor.status(id).audio,false);f.failInput(false);
 f.monitor.audio(id,true);f.inputs.at(-1).push(new Uint8Array([1,2]).buffer);assert.equal(f.monitor.readAudio(id).byteLength,2);await f.monitor.stop(id);
});

test('subtitles are opt-in, cleared after speech, and validated before playback',async()=>{
 const f=setup(),id=f.monitor.start().id;
 await f.monitor.command(id,'speak',{text:'字幕なし'});assert.equal(f.calls.filter(c=>c[0]==='showBalloon').length,0);
 await f.monitor.command(id,'speak',{text:'字幕あり',subtitles:true});assert.equal(f.calls.filter(c=>c[0]==='showBalloon').length,1);assert.equal(f.calls.filter(c=>c[0]==='showBalloon')[0][1],'字幕あり');assert.deepEqual(f.calls.at(-1),['hideBalloon']);
 const before=f.calls.length;await assert.rejects(f.monitor.command(id,'speak',{text:'無効',subtitles:'yes'}));assert.equal(f.calls.length,before);await f.monitor.stop(id);
});
test('turning LIVE audio off during speech prevents microphone restart',async()=>{
 const f=setup(),id=f.monitor.start().id;f.monitor.audio(id,true);const resolve=f.deferSpeech();const speaking=f.monitor.command(id,'speak',{text:'読み上げ中'});
 assert.equal(f.inputs[0].closed,true);f.monitor.audio(id,false);resolve();await speaking;assert.equal(f.inputs.length,1);assert.equal(f.monitor.status(id).audio,false);await f.monitor.stop(id);
});
