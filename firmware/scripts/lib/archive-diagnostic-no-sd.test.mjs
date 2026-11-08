import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=name=>fs.readFileSync(new URL('../../host/app/'+name,import.meta.url),'utf8').replace(/^import [\s\S]*? from '[^']+';?\s*$/gm,'').replace(/export /g,'')

test('vault peek does not mount SD and sees loaded state without re-reading',()=>{
  let calls=0
  const c=vm.createContext({withSDCard:fn=>{calls++;fn({createDirectory(){},openFile(){throw Error('missing')}})}})
  vm.runInContext(source('archive-vault.js'),c)
  assert.equal(vm.runInContext('peekSettings()',c),undefined)
  assert.equal(calls,0)
  vm.runInContext('loadSettings()',c)
  assert.equal(calls,1)
  assert.equal(vm.runInContext('peekSettings().generation',c),0)
  assert.equal(calls,1)
})

test('chat diagnostics return only cached flags, runtime state and heap without speaker or SD lookup',()=>{
  let cached,heapReads=0
  const deny=()=>{throw Error('SD/provider lookup from diagnostic')}
  const c=vm.createContext({
    VoiceRegistration:class{},peekSettings:()=>cached,getSettings:deny,currentSpeaker:deny,users:deny,
    heapStatus:()=>{heapReads++;return {internalFree:123}},
  })
  vm.runInContext(source('archive-direct-chat.js'),c)
  let result=vm.runInContext('directChatDiagnostic()',c)
  assert.equal(result.enabled,null)
  cached={chatMode:false,transcriptionMode:false,api:{secret:'NEVER_EXPOSE'}}
  result=vm.runInContext('directChatDiagnostic()',c)
  assert.equal(result.enabled,false)
  assert.equal(result.recognitionMode,false)
  assert.equal(result.memory.internalFree,123)
  assert.equal(heapReads,2)
  assert.deepEqual(Object.keys(result).sort(),['enabled','memory','recognitionMode','state'])
})
