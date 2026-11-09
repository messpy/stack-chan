import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {stripTypeScriptTypes} from 'node:module'

async function boot(fail) {
  const events=[],screens=[],calls=[],cache=new Map()
  const context=vm.createContext({trace(){}})
  const error=vm.runInContext('new ReferenceError("private-token")',context)
  const step=name=>{calls.push(name);if(fail===name)throw error}
  let snapshot
  const diagnostics={installDebugLog(){},recordStartupCheckpoint(phase,error,component='none',state='begin'){
    snapshot={phase,error:error?.name??'none',component,componentState:state};events.push({...snapshot})
  },startupDiagnosticSnapshot:()=>snapshot}
  const robot={ui:{miniApps:{}},lifecycle:{async close(){calls.push('cleanup')}}}
  const deps={
    loadPreference:{default:()=>({}),loadModConfig:()=>({}),loadPreferenceConfig:()=>({})},
    'embedded:system':{default:{}},'app-behavior-resolver':{resolveAppBehaviors:(_modules,behavior)=>[behavior]},
    'app-default-behavior':{default:{async onContextCreated(_robot,options){
      await Promise.resolve();step('context-behaviors')
      options.initialize('default-setup',()=>step('default-setup'))
    }}},
    'app-launch':{runLaunchBehaviors(){},installLaunchShortcut(){step('mod-shortcut')},prepareAppLaunch:async()=>({shouldCreateContext:true,prepared:{}})},
    'boot-services':{startHostBootServices:()=>({connectivity:{network:{ready:Promise.resolve({status:'skipped'})}}})},
    'boot-network-recovery':{classifyBootWiFiFailure(){},waitForBootWiFiRecoveryChoiceWithTimeout(){}},
    compose:{createStackchanContext:()=>robot,getHostDeviceEnvironment:()=>({})},consts:{DOMAIN:{ui:'ui',time:'time'}},
    dock:{startStackchanDock:()=>({onContextCreated(){step('dock-context')},close(){}})},
    'experimental-mini-app-loader':{prepareExperimentalMiniApps(){},registerExperimentalMiniApps(){step('experimental-miniapps')}},
    localization:{initializeLocalization(){}},'timezone-settings':{applyTimezone(){}},timer:{default:{}},
    modules:{default:{has:name=>['archive-debug','lan-archive','mod-manager'].includes(name),importNow(name){
      if(name==='archive-debug')return diagnostics
      if(name==='lan-archive'){
        step('archive-import')
        return {startArchive(_robot,initialize){step('archive-start');initialize('archive-offline',()=>step('archive-offline'))}}
      }
      throw Error('unexpected import')
    }}},
    'startup-splash':{showStartupError:options=>screens.push(options),showStartupSplash(){},showWiFiConnectionStatus(){},showWiFiRecoveryChoice(){},startupErrorClass:e=>e.name},
  }
  vm.runInContext('globalThis.button={power:{}}',context)
  async function load(name){
    if(cache.has(name))return cache.get(name)
    let module
    if(deps[name])module=new vm.SyntheticModule(Object.keys(deps[name]),function(){for(const[k,v]of Object.entries(deps[name]))this.setExport(k,v)},{context})
    else module=new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(new URL('../../host/app/'+name+'.ts',import.meta.url),'utf8'),{mode:'strip'}),{context})
    cache.set(name,module);await module.link(load);return module
  }
  const main=await load('main');await main.evaluate()
  for(let i=0;i<30;i++)await Promise.resolve()
  return {events,screens,calls,error}
}
for(const component of ['dock-context','experimental-miniapps','context-behaviors','archive-import','archive-start','mod-shortcut','default-setup','archive-offline']){
 test('boot preserves ReferenceError and exact failing component: '+component,async()=>{
  const result=await boot(component)
  assert.equal(result.screens.length,1)
  assert.equal(result.screens[0].error,result.error)
  assert.equal(result.events.at(-1).phase,'behavior')
  assert.equal(result.events.at(-1).component,component)
  assert.equal(result.events.at(-1).componentState,'failed')
  assert.ok(!result.events.some(event=>event.phase==='ready'))
  assert.equal(result.calls.filter(call=>call==='cleanup').length,1)
 })
}
test('ready is emitted after all behavior operations including shortcut',async()=>{
 const result=await boot()
 assert.equal(result.screens.length,0)
 assert.equal(result.events.at(-1).phase,'ready')
 assert.equal(result.calls.at(-1),'mod-shortcut')
 assert.ok(result.events.some(e=>e.component==='context-behaviors'&&e.componentState==='done'))
})
