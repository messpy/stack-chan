import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {test} from 'node:test'
import {createVoiceCommandController,parseVoiceText} from '../../host/app/archive-voice-command-policy.js'

function mockVoiceRuntime(){
  const tasks=[];const spoken=[];let volume=30,qr=0,stopAI=0,moved='';
  const fakeTimer={set(callback,delay){assert.equal(delay,0);tasks.push(callback);return tasks.length}}
  const ctx=vm.createContext({Timer:fakeTimer,createVoiceCommandController,parseVoiceText,trace() {}})
  const source=readFileSync(new URL('../../host/app/archive-voice-control.js',import.meta.url),'utf8')
    .replace(/^import .+;\s*$/gm,'').replace(/^export /gm,'')
  vm.runInContext(source+'\n;globalThis.api={startVoiceControl,handleVoiceTranscript,handleKoeActResult};',ctx)
  const actions={getVolume:()=>({percent:volume}),setVolume:value=>volume=value,openQR:()=>qr++,stopAI:()=>stopAI++,moveHead:dir=>moved=dir,feedback:msg=>spoken.push(msg)}
  actions.setExpression=()=>{};actions.setLED=()=>{};
  ctx.api.startVoiceControl(actions)
  return {ctx,tasks,spoken,get volume(){return volume},get qr(){return qr},get stopAI(){return stopAI},get moved(){return moved}}
}

test('STT fallback performs local volume changes and schedules QR/AI-OFF outside callback',()=>{
  const fixture=mockVoiceRuntime(),api=fixture.ctx.api
  assert.equal(api.handleVoiceTranscript('音量を37%にして'),true)
  assert.equal(fixture.volume,37)
  assert.equal(api.handleVoiceTranscript('一般の会話だよ'),false)
  assert.equal(api.handleVoiceTranscript('サイトのQRを出して'),true)
  assert.equal(api.handleVoiceTranscript('AIモードをオフにして'),true)
  assert.equal(fixture.qr,0);assert.equal(fixture.stopAI,0)
  for(const work of fixture.tasks)work()
  assert.equal(fixture.qr,1);assert.equal(fixture.stopAI,1)
})

test('KoeAct adapter rejects low-confidence input and schedules validated motion',()=>{
  const fixture=mockVoiceRuntime(),api=fixture.ctx.api
  assert.equal(api.handleKoeActResult({pAct:.9,actions:[{name:'look',arguments:{direction:'right',amount:'normal'}}]}),false)
  assert.equal(api.handleKoeActResult({pAct:.99,actions:[{name:'look',arguments:{direction:'right',amount:'normal'}}]}),true)
  assert.equal(fixture.moved,'')
  for(const work of fixture.tasks)work()
  assert.equal(fixture.moved,'right')
})
