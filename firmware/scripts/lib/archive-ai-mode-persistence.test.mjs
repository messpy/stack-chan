import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {test} from 'node:test'

const file=new URL('../../host/app/archive-direct-chat.js',import.meta.url)
const source=fs.readFileSync(file,'utf8')
const start=source.indexOf('export function setChatMode(on) {')
const end=source.indexOf('export function setRecognitionMode(on)',start)
assert.ok(start>=0&&end>start,'setChatMode implementation is present')
const implementation=source.slice(start,end).replace('export function','function')

function harness(initial,failWrite=false){
  const settings={chatMode:initial,transcriptionMode:false,directChat:{cloudConsent:true}}
  const events=[]
  const context={
    getSettings:()=>settings,chatProvider:()=> 'xiaozhi',cloudConfig:()=>settings.directChat,
    enabled:()=>settings.chatMode===true,modeChanged:on=>events.push('mode:'+on),
    changeSettings:change=>{events.push('write');if(failWrite)throw Error('SD unavailable');change(settings)},
    chatSaveFailedOff:false,recognitionSaveFailedOff:false,
    closeChat:()=>{},collectMemory:()=>{},beginConversation:()=>events.push('begin'),
    resetTranscripts:()=>{},enrollment:{reset:()=>{}},robot:{drawer:{setDrawerButtonState:()=>{}},ui:{removeEffect:()=>{}}},
    modeLabel:null,speakerStrip:null,refreshAITalk:null,refreshRecognition:null,
    directChatStatus:()=>({enabled:settings.chatMode}),trace:()=>{},state:'off'
  }
  const setChatMode=vm.runInNewContext(implementation+'\nsetChatMode',context)
  return {setChatMode,settings,events}
}

test('boot restore does not rewrite an already persisted ON preference',()=>{
  const h=harness(true)
  h.setChatMode(true)
  assert.equal(h.events.includes('write'),false)
  assert.deepEqual(h.events,['mode:true'])
})
test('turning ON persists before changing audio ownership',()=>{
  const h=harness(false)
  h.setChatMode(true)
  assert.equal(h.settings.chatMode,true)
  assert.deepEqual(h.events.slice(0,3),['write','mode:true','begin'])
})
test('failed ON persistence does not switch audio ownership',()=>{
  const h=harness(false,true)
  assert.throws(()=>h.setChatMode(true),/SD unavailable/)
  assert.equal(h.settings.chatMode,false)
  assert.deepEqual(h.events,['write'])
})
