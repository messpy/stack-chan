import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const raw=readFileSync(new URL('../../host/app/archive-vault.js',import.meta.url),'utf8')
const source=raw.replace(/^import .*$/gm,'').replaceAll('export function ','function ')

function fixture(entries={}) {
  const log=[],files=new Map(Object.entries(entries))
  const StringWithBuffer=Object.assign(
    Object.create(String),
    {fromArrayBuffer:bytes=>Buffer.from(bytes).toString('utf8')},
  )
  const root={
    createDirectory(){},
    openFile({path,mode}) {
      if(mode==='w')throw Error('write is prohibited in read-only test')
      const entry=files.get(path)
      if(entry===undefined)throw Error('not found')
      if(entry==='unopenable')throw Error('permission denied')
      return {
        status:()=>({size:Buffer.byteLength(String(entry))}),
        read:()=>Buffer.from(String(entry)),
        close(){},
      }
    },
    status(path){if(!files.has(path))throw Error('not found');return {size:1}},
  }
  const context={
    trace:line=>log.push(line),
    String:StringWithBuffer,Buffer,
    openVault:buffer=>buffer,
    sealVault:()=>{throw Error('unexpected encryption')},
    randomBytes:()=>new Uint8Array(16),
    withSDCard:fn=>fn(root),
  }
  const f=vm.runInNewContext(source+'\n({loadSettings,getSettings,vaultStatus,changeSettings})',context)
  return {...f,log}
}
const slot=(n,content)=>({['stackchan/settings-'+n+'.bin']:content})
const valid=(gen,chat,transcription)=>JSON.stringify({generation:gen,reminders:[],api:{},chatMode:chat,transcriptionMode:transcription})

test('latest valid generation determines persisted mode on reboot',()=>{
  const h=fixture({...slot(0,valid(6,false,false)),...slot(1,valid(7,true,false))})
  assert.equal(h.loadSettings().generation,7)
  assert.equal(h.getSettings().chatMode,true)
  assert.equal(h.vaultStatus().unreadableSlots,0)
  assert.equal(h.vaultStatus().loadError,false)
})

test('corrupt recent slot triggers visible degraded recovery, not silent fallback',()=>{
  const h=fixture({...slot(0,valid(6,false,false)),...slot(1,'invalid-encrypted-data')})
  assert.equal(h.loadSettings().generation,6)
  assert.equal(h.vaultStatus().unreadableSlots,1)
  assert.equal(h.vaultStatus().loadError,false)
  assert.ok(h.log.some(x=>x.includes('recovered older valid snapshot')))
})

test('both corrupted slots block mutations and preserve originals',()=>{
  const h=fixture({...slot(0,'broken'),...slot(1,'also-broken')})
  assert.equal(h.loadSettings().generation,0)
  assert.equal(h.vaultStatus().loadError,true)
  assert.equal(h.vaultStatus().unreadableSlots,2)
  assert.throws(()=>h.changeSettings(v=>{v.chatMode=true}),/保存済み設定を読み取れません/)
})

test('an existing but unopenable slot is different from a fresh installation',()=>{
  const h=fixture(slot(0,'unopenable'))
  h.loadSettings()
  assert.equal(h.vaultStatus().loadError,true)
  assert.equal(h.vaultStatus().unreadableSlots,1)
})

test('absent vault slots are not mistaken for corrupt settings',()=>{
  const h=fixture()
  assert.equal(h.loadSettings().generation,0)
  assert.equal(h.vaultStatus().loadError,false)
  assert.equal(h.vaultStatus().unreadableSlots,0)
})
