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

function harness(initial,failWrite=false,failMode=false){
  const settings={chatMode:initial,transcriptionMode:false,directChat:{cloudConsent:true}}
  const events=[]
  const context={
    getSettings:()=>settings,chatProvider:()=> 'xiaozhi',cloudConfig:()=>settings.directChat,
    enabled:()=>settings.chatMode===true,recognitionMode:()=>settings.transcriptionMode===true,modeChanged:on=>{events.push('mode:'+on);if(failMode)throw Error('audio handoff blocked')},
    changeSettings:change=>{events.push('write');if(failWrite)throw Error('SD unavailable');change(settings)},
    chatSaveFailedOff:false,recognitionSaveFailedOff:false,
    closeChat:()=>events.push('close'),collectMemory:()=>{},beginConversation:()=>events.push('begin'),
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
test('failed audio handoff rolls back persisted ON preference',()=>{
  const settings={chatMode:false,transcriptionMode:false,directChat:{cloudConsent:true}}
  const events=[]
  const context={
    getSettings:()=>settings,chatProvider:()=> 'xiaozhi',cloudConfig:()=>settings.directChat,
    enabled:()=>settings.chatMode===true,recognitionMode:()=>false,
    modeChanged:()=>{events.push('mode');throw Error('local speech busy')},
    changeSettings:change=>{events.push('write');change(settings)},
    chatSaveFailedOff:false,recognitionSaveFailedOff:false,
    closeChat:()=>{},collectMemory:()=>{},beginConversation:()=>{},
    resetTranscripts:()=>{},enrollment:{reset:()=>{}},robot:{drawer:{setDrawerButtonState:()=>{}},ui:{removeEffect:()=>{}}},
    modeLabel:null,speakerStrip:null,refreshAITalk:null,refreshRecognition:null,
    directChatStatus:()=>({enabled:settings.chatMode}),trace:()=>{},state:'off'
  }
  const setChatMode=vm.runInNewContext(implementation+'\nsetChatMode',context)
  assert.throws(()=>setChatMode(true),/local speech busy/)
  assert.equal(settings.chatMode,false)
  assert.deepEqual(events,['write','mode','write'])
})

test('failed ON persistence does not switch audio ownership',()=>{
  const h=harness(false,true)
  assert.throws(()=>h.setChatMode(true),/SD unavailable/)
  assert.equal(h.settings.chatMode,false)
  assert.deepEqual(h.events,['write'])
})

const recognitionStart=source.indexOf('export function setRecognitionMode(on)')
const recognitionEnd=source.indexOf('let memoryCleanupTimer',recognitionStart)
assert.ok(recognitionStart>=0&&recognitionEnd>recognitionStart,'setRecognitionMode implementation is present')
const recognitionImplementation=source.slice(recognitionStart,recognitionEnd).replace('export function','function')

function recognitionHarness(initial,failWrite=false,failMode=false){
  const settings={chatMode:false,transcriptionMode:initial,directChat:{cloudConsent:true}}
  const events=[]
  const context={
    getSettings:()=>settings,cloudConfig:()=>settings.directChat,
    modeChanged:on=>{events.push('mode:'+on);if(failMode)throw Error('audio handoff blocked')},
    changeSettings:change=>{events.push('write');if(failWrite)throw Error('SD unavailable');change(settings)},
    recognitionSaveFailedOff:false,chatSaveFailedOff:false,
    closeChat:()=>events.push('close'),collectMemory:()=>{},enrollment:{reset:()=>{}},
    resetTranscripts:()=>{},refreshRecognition:null,refreshAITalk:null,
    running:()=>settings.transcriptionMode,trace:()=>{},directChatStatus:()=>({recognitionMode:settings.transcriptionMode})
  }
  const setRecognitionMode=vm.runInNewContext(recognitionImplementation+'\nsetRecognitionMode',context)
  return {setRecognitionMode,settings,events}
}
test('recognition restore does not rewrite persisted ON',()=>{
  const h=recognitionHarness(true)
  h.setRecognitionMode(true)
  assert.equal(h.events.includes('write'),false)
  assert.equal(h.events[0],'mode:true')
})
test('recognition ON persists before taking audio ownership',()=>{
  const h=recognitionHarness(false)
  h.setRecognitionMode(true)
  assert.deepEqual(h.events.slice(0,2),['write','mode:true'])
})
test('failed recognition ON does not change audio ownership',()=>{
  const h=recognitionHarness(false,true)
  assert.throws(()=>h.setRecognitionMode(true),/SD unavailable/)
  assert.equal(h.settings.transcriptionMode,false)
  assert.deepEqual(h.events,['write'])
})

test('switching from transcription to conversation closes the old recognition session',()=>{
  const h=harness(false)
  h.settings.transcriptionMode=true
  h.setChatMode(true)
  assert.equal(h.settings.chatMode,true)
  assert.equal(h.settings.transcriptionMode,false)
  assert.deepEqual(h.events.slice(0,4),['write','mode:true','close','begin'])
})
test('failed conversation handoff restores prior transcription mode',()=>{
  const h=harness(false,false,true)
  h.settings.transcriptionMode=true
  assert.throws(()=>h.setChatMode(true),/audio handoff blocked/)
  assert.equal(h.settings.chatMode,false)
  assert.equal(h.settings.transcriptionMode,true)
  assert.deepEqual(h.events,['write','mode:true','write'])
})
test('failed transcription handoff restores previous conversation mode',()=>{
  const h=recognitionHarness(false,false,true)
  h.settings.chatMode=true
  assert.throws(()=>h.setRecognitionMode(true),/audio handoff blocked/)
  assert.equal(h.settings.chatMode,true)
  assert.equal(h.settings.transcriptionMode,false)
  assert.deepEqual(h.events,['write','mode:true','write'])
})
