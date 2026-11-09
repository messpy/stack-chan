import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {stripTypeScriptTypes} from 'node:module'

async function harness(fail, invalidSelection=false) {
  const events=[], calls=[], failure=new Error('private-token must stay private'), cache=new Map()
  const context=vm.createContext({trace(){},Behavior:class{}})
  const fake=name=>class { constructor(...args){calls.push(name);if(name===fail)throw failure;this.args=args} }
  const config={Touch:class{},TouchPanel:class{}}
  context.device={sensor:{IMU:class{}}}
  const Runtime=class {
    constructor(params){
      this.params=params
      params.initialize('runtime-audio',()=>{if(fail==='runtime-audio')throw failure})
    }
  }
  const Modules={has:name=>['audio-in','media-player'].includes(name),importNow:()=>fake('media')}
  class Content {
    constructor(data={},dictionary={}) {Object.assign(this,data,dictionary);this.contents=dictionary.contents||[]}
    empty(){this.contents=[]}
    add(item){this.contents.push(item);item.container=this}
  }
  const deps={
    'app-controller':{createAppControllerApplication:(...args)=>{calls.push('ui');if(fail==='ui')throw failure;return {args}}},
    'behaviors/face':{DogFace:fake('face'),SimpleFace:fake('face'),SmallFace:fake('face')},
    camera:{default:fake('camera')},'chat-status-bar':{ChatStatusBar:fake('bar')},consts:{DOMAIN:{tts:'tts'}},
    'dynamixel-driver':{DynamixelDriver:fake('driver')},imu:{default:fake('imu')},
    'jitome-face':{createJitomeFace:()=>({content:{}})},led:{default:fake('led')},
    'm5stackchan-servo-driver':{M5StackChanServoDriver:fake('driver')},'mc/config':{default:config},
    microphone:{default:fake('microphone')},modules:{default:Modules},'none-driver':{NoneDriver:fake('driver')},
    'parts/image/deal-with-it-face':{DealWithItFace:fake('face')},'parts/image/image-avatar-face':{ImageAvatarFace:fake('face')},
    preference:{default:{set(){throw Error('startup must not write preferences')}}},'py32-led':{default:fake('led')},
    'rs30x-driver':{RS30XDriver:fake('driver')},'runtime-context':{StackchanRuntimeContext:Runtime},
    'scservo-driver':{SCServoDriver:fake('driver')},'sg90-driver':{PWMServoDriver:fake('driver')},
    speaker:{default:fake('speaker')},touch:{default:fake('touch')},'touch-panel':{default:fake('touch-panel')},
    'volume-model':{canonicalizeVolume:value=>value},
    localization:{localize:key=>key},'piu/MC':{Application:Content,Column:Content,Container:Content,Label:Content},
    'ui-controls':{ActionButton:Content},'ui-theme':{UI:{touchTarget:44},uiStyles:()=>({})},
  }
  for(const name of ['elevenlabs','local','openai','remote','stackchan-voice','voicevox','voicevox-web'])deps['tts-'+name]={TTS:fake('tts')}
  async function load(name){
    if(cache.has(name))return cache.get(name)
    let module
    if(deps[name])module=new vm.SyntheticModule(Object.keys(deps[name]),function(){for(const[k,v]of Object.entries(deps[name]))this.setExport(k,v)},{context})
    else {
      const path=name==='startup-splash'?'../../host/modules/ui/views/splash/splash-view.ts':'../../host/app/'+name+'.ts'
      const source=stripTypeScriptTypes(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'strip'})
      module=new vm.SourceTextModule(source,{context})
    }
    cache.set(name,module);await module.link(load);return module
  }
  const compose=await load('compose');await compose.evaluate()
  const helpers=cache.get('context-startup').namespace
  const initialize=helpers.createContextInitializer(event=>events.push(event))
  const preferences={driver:{type:'none'},tts:{type:'local',volume:.1},ui:{type:invalidSelection?'private-invalid-ui':'simple'},led:{head:{type:'py32',ledPin:13,length:12}}}
  return {compose:compose.namespace,helpers,preferences,initialize,events,calls,failure,load,context}
}

test('normal composition preserves official Face path and initializes without networking/settings writes',async()=>{
  const h=await harness()
  const result=h.compose.createStackchanContext(h.preferences,{initialize:h.initialize})
  assert.ok(result.params.ui);assert.deepEqual(h.calls.slice(0,4),['driver','face','bar','ui'])
  assert.equal(h.events.filter(e=>e.state==='failed').length,0)
  assert.ok(h.events.some(e=>e.component==='runtime-audio'&&e.state==='done'))
})
for(const component of ['driver','ui','tts','touch','touch-panel','microphone','camera','speaker','media','led','runtime-audio']){
  test(component+' failure is attributed to its deepest component and preserves original exception',async()=>{
    const h=await harness(component)
    assert.throws(()=>h.compose.createStackchanContext(h.preferences,{initialize:h.initialize}),error=>error===h.failure)
    const failures=h.events.filter(e=>e.state==='failed')
    assert.equal(failures.length,1);assert.equal(failures[0].component,component)
    assert.ok(h.events.some(e=>e.component===component&&e.state==='begin'))
    assert.equal(h.events.at(-1).state,'failed')
  })
}
test('IMU initialization failure is an optional input degradation, not a fatal startup error',async()=>{
  const h=await harness('imu')
  const result=h.compose.createStackchanContext(h.preferences,{initialize:h.initialize})
  assert.equal(result.params.imu,undefined)
  assert.ok(result.params.ui)
  assert.ok(h.calls.includes('camera'))
  assert.ok(h.calls.includes('speaker'))
  assert.ok(h.events.some(e=>e.component==='imu'&&e.state==='done'))
  assert.equal(h.events.filter(e=>e.state==='failed').length,0)
})
test('unsupported preference type fails before any native component is created',async()=>{
  const h=await harness(undefined,true)
  assert.throws(()=>h.compose.createStackchanContext(h.preferences,{initialize:h.initialize}))
  assert.equal(h.events.at(-1).component,'selection');assert.equal(h.calls.length,0)
})
test('diagnostic observer exceptions do not change initialization or its original failure',async()=>{
  const h=await harness()
  const initialize=h.helpers.createContextInitializer(()=>{throw Error('observer failure')})
  assert.equal(initialize('preferences',()=>42),42)
  assert.throws(()=>initialize('driver',()=>{throw h.failure}),e=>e===h.failure)
})
test('USB-independent failure screen shows safe component and RAM without exception text',async()=>{
  const h=await harness(),m=await h.load('startup-splash');await m.evaluate()
  const screen=m.namespace.showStartupError({phase:'context',error:vm.runInContext('new Error("private-token")',h.context),
    diagnostic:{component:'imu',reason:'memory',internalFree:200,internalLargest:80,psramFree:400,token:'private-token'},onRestart(){}})
  const strings=[]
  const visit=node=>{if(node.string)strings.push(node.string);for(const child of node.contents||[])visit(child)}
  visit(screen)
  assert.ok(strings.includes('imu / memory'));assert.ok(strings.includes('RAM 200 / 80  PS 400'))
  assert.ok(!strings.join(' ').includes('private-token'))
  const bad=h.helpers.startupDiagnosticLines({component:'private-token',reason:'private-token'})
  assert.equal(bad.length,0)
})

test('async startup waits for fulfillment and preserves rejected exception',async()=>{
 const h=await harness(),events=[];let resolve;
 const initialize=h.helpers.createAsyncContextInitializer(event=>events.push(event));
 const pending=initialize('context-behaviors',()=>new Promise(done=>resolve=done));
 assert.deepEqual(events.map(e=>e.state),['begin']);resolve(42);
 assert.equal(await pending,42);assert.deepEqual(events.map(e=>e.state),['begin','done']);
 await assert.rejects(initialize('context-behaviors',async()=>{await Promise.resolve();throw h.failure}),e=>e===h.failure);
 assert.equal(events.at(-1).state,'failed');assert.equal(events.at(-1).error,h.failure);
})
