import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {stripTypeScriptTypes} from 'node:module'
async function harness(saved,stored={},failVaultRead=false){
 const calls=[],timers=[],context=vm.createContext({trace(){}}),cache=new Map()
 class WiFi{static Mode={none:0,station:1,accessPoint:2};static connect(value){calls.push(value)}constructor(callback){this.callback=callback}close(){}}
 const deps={
  'stored-wifi':{readStoredWiFiPreference:key=>stored[key]||'',connectStoredWiFi(options){calls.push(options);options.onConnected();return true},stopStoredWiFiConnection(){}},
  'local-peer-capability':{createLocalPeerCapability:()=>undefined},'stackchan-util':{wait:async()=>{}},'mc/config':{default:{wifi:{ssid:'manifest-network',password:'manifest-password'}}},
  localization:{localize:key=>key},
  'archive-local-clock':{setLocalTime(){}},wifi:{default:WiFi},http:{Request:class{}},
  'archive-http-server':{default:class{}},net:{default:{get:()=>''}},timer:{default:{set(fn){timers.push(fn);return timers.length},clear(){}}},time:{default:{}},sntp:{default:class{}},
  'piu/QRCode':{default:class{}},'piu/MC':{Container:class{},Label:class{},Text:class{},Skin:class{},Style:class{}},
  'ui-controls':{ActionButton:class{}},'ui-theme':{uiFont:()=>''},'http-server-service':{HttpServerService:class{},Response:class{}},
  'archive-vault':{getSettings:()=>{if(failVaultRead)throw Error('SD read failed');return saved},changeSettings(){throw Error('No settings write allowed')},vaultStatus:()=>({ssid:saved.wifi?.ssid||''}),vaultSelfTest(){},randomHex:()=>''},
 }
 async function load(name){
  if(cache.has(name))return cache.get(name)
  let module
  if(deps[name])module=new vm.SyntheticModule(Object.keys(deps[name]),function(){for(const[k,v]of Object.entries(deps[name]))this.setExport(k,v)},{context})
  else{let source=fs.readFileSync(new URL('../../host/app/'+name+(['boot-network-recovery','boot-services'].includes(name)?'.ts':'.js'),import.meta.url),'utf8');if(['boot-network-recovery','boot-services'].includes(name))source=stripTypeScriptTypes(source,{mode:'strip'});module=new vm.SourceTextModule(source,{context})}
  cache.set(name,module);await module.link(load);return module
 }
 const m=await load('archive-settings');await m.evaluate();const p=cache.get('boot-network-recovery');await p.evaluate()
 const robot={ui:{miniApps:{register(){}}}}
 return {api:m.namespace,policy:p.namespace,calls,timers,robot,boot:async()=>{const m=await load('boot-services');await m.evaluate();return m.namespace}}
}
test('explicit offline boot preserves vault credentials and suppresses automatic connection until explicit reconnect',async()=>{
 const saved={wifi:{ssid:'example',password:'example-password'},api:{}}
 const before=JSON.stringify(saved),h=await harness(saved)
 h.policy.requestOfflineBoot();h.api.startSettings(h.robot);h.api.closeSettings()
 assert.equal(h.calls.length,0);assert.equal(JSON.stringify(saved),before)
 h.api.reconnectSavedWiFi();assert.equal(h.calls.length,1);assert.equal(h.policy.isOfflineBootRequested(),false)
})
test('standard NVS Wi-Fi remains usable when the SD vault has no Wi-Fi configuration',async()=>{
 const saved={wifi:null,api:{}},h=await harness(saved,{ssid:'nvs-network',password:'nvs-password'})
 h.api.startSettings(h.robot)
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].ssid,'nvs-network');assert.equal(h.calls[0].password,'nvs-password')
 assert.equal(h.api.getSettingsStatus().ssid,'nvs-network');assert.equal(saved.wifi,null)
})
test('offline boot blocks NVS fallback connection without deleting credentials',async()=>{
 const saved={wifi:null,api:{}},stored={ssid:'nvs-network',password:'nvs-password'},h=await harness(saved,stored)
 h.policy.requestOfflineBoot();h.api.startSettings(h.robot)
 assert.equal(h.calls.length,0);assert.equal(stored.ssid,'nvs-network');assert.equal(h.api.getSettingsStatus().ssid,'nvs-network')
})

test('offline choice skips manifest-default boot Wi-Fi without erasing credentials',async()=>{
 const h=await harness({wifi:null,api:{}}),boot=await h.boot()
 h.policy.requestOfflineBoot()
 const result=await boot.startHostBootServices().connectivity.network.ready
 assert.equal(result.status,'skipped');assert.equal(h.calls.length,0)
 h.policy.resumeBootWiFi()
 const online=await boot.startHostBootServices().connectivity.network.ready
 assert.equal(online.status,'connected');assert.equal(h.calls.length,1)
 assert.equal(h.calls[0].ssid,'manifest-network')
})


test('SD vault read exception falls back to existing NVS Wi-Fi without writing',async()=>{
 const saved={wifi:null,api:{}},stored={ssid:'nvs-network',password:'nvs-password'};
 const h=await harness(saved,stored,true);
 h.api.startSettings(h.robot);
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].ssid,'nvs-network');
 assert.equal(h.calls[0].password,'nvs-password');
 const status=h.api.getSettingsStatus();
 assert.equal(status.ssid,'nvs-network');
 assert.equal(status.provider,'xiaozhi');
 assert.equal(stored.ssid,'nvs-network');
 assert.equal(saved.wifi,null);
});
test('SD vault exception with explicit offline selection does not auto-connect',async()=>{
 const saved={wifi:null,api:{}},stored={ssid:'nvs-network',password:'nvs-password'};
 const h=await harness(saved,stored,true);
 h.policy.requestOfflineBoot();
 h.api.startSettings(h.robot);
 assert.equal(h.calls.length,0);
 assert.equal(h.api.getSettingsStatus().ssid,'nvs-network');
});
