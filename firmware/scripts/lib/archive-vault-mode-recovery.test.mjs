import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source=readFileSync(new URL('../../host/app/archive-vault.js',import.meta.url),'utf8')
const begin=source.indexOf('export function changeSettings(change){')
const end=source.indexOf('export function vaultStatus()',begin)
const statusEnd=source.indexOf('export function vaultSelfTest()',end)
assert.ok(begin>=0&&end>begin&&statusEnd>end)
const code=source.slice(begin,statusEnd).replaceAll('export function','function')

function mock(unreadable) {
  let writes=0
  const context={
    data:{generation:8,chatMode:true,transcriptionMode:false,api:{},reminders:[]},
    loadError:unreadable,
    unreadableSlots:unreadable?2:0,
    loadSettings:()=>undefined,
    sealVault:()=>({length:3}),
    ArrayBuffer:{fromString:()=>({})},
    withSDCard:fn=>fn({openFile:()=>({
      write(){writes++},flush(){},close(){}
    })}),
  }
  vm.runInNewContext(code+'\n(globalThis.result={changeSettings,vaultStatus})',context)
  return {context,write:fn=>context.result.changeSettings(fn),status:()=>context.result.vaultStatus(),getWrites:()=>writes}
}

test('unreadable encrypted mode snapshots cannot be overwritten by a default OFF',()=>{
  const h=mock(true)
  assert.throws(()=>h.write(data=>{data.chatMode=false}),/保存済み設定を読み取れません/)
  assert.equal(h.getWrites(),0)
  assert.equal(h.context.data.chatMode,true)
  assert.equal(h.status().loadError,true)
  assert.equal(h.status().unreadableSlots,2)
})

test('healthy settings persist one generation and report both mode values',()=>{
  const h=mock(false)
  h.write(data=>{data.chatMode=false;data.transcriptionMode=true})
  assert.equal(h.getWrites(),1)
  assert.equal(h.context.data.generation,9)
  assert.equal(h.status().chatMode,false)
  assert.equal(h.status().transcriptionMode,true)
  assert.equal(h.status().loadError,false)
})

test('no API tokens appear in vault mode diagnostics',()=>{
  const h=mock(false)
  h.context.data.api={gemini:'dummy-secret-token'}
  const status=h.status()
  assert.deepEqual(Array.from(status.apiNames),['gemini'])
  assert.equal(JSON.stringify(status).includes('dummy-secret-token'),false)
})
