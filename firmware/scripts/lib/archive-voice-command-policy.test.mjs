import assert from 'node:assert/strict'
import {test} from 'node:test'
import {parseVoiceText,decodeKoeActActions,createVoiceCommandController} from '../../host/app/archive-voice-command-policy.js'

test('safe Japanese transcript parser recognizes device commands exactly', () => {
  for(const [text,expected] of [
    ['スタックちゃん、音量を上げて',{type:'volume_delta',value:10}],
    ['音量下げて',{type:'volume_delta',value:-10}],
    ['音量を３７％にして',{type:'volume',value:37}],
    ['音量を100パーセントにして',{type:'volume',value:100}],
    ['音量を101%にして',{type:'invalid_volume'}],
    ['サイトのQRを出して',{type:'qr'}],
    ['AIモードをオフにして',{type:'ai_off'}],
    ['シャットダウンして',{type:'shutdown_request'}],
    ['シャットダウン実行',{type:'shutdown_confirm'}],
  ]) assert.deepEqual(parseVoiceText(text),expected,text)
  for(const text of ['音量を上げないで','AIをオフにできる？','シャットダウンしたら','シャットダウンしないで','さっき音量上げたよ','ただの会話です']) assert.equal(parseVoiceText(text),null,text)
})

test('KoeAct actions require >=0.97 pAct and exact bounded schema',()=>{
  const sample = {pAct:.99,actions:[{name:'set_volume',arguments:{level:45}},{name:'look',arguments:{direction:'right',amount:'normal'}}]}
  assert.deepEqual(decodeKoeActActions(sample),[{type:'volume',value:45},{type:'look',value:'right'}])
  for(const invalid of [
    {...sample,pAct:.969},
    {...sample,actions:[{name:'set_volume',arguments:{level:101}}]},
    {...sample,actions:[{name:'shutdown',arguments:{}}]},
    {...sample,actions:[{name:'set_volume',arguments:{level:45,evil:1}}]},
    {...sample,actions:[...sample.actions,...sample.actions]},
    {...sample,actions:[sample.actions[0],{name:'set_brightness',arguments:{level:50}}]},
    {...sample,actions:[]}
  ])assert.equal(decodeKoeActActions(invalid),null)
  assert.deepEqual(decodeKoeActActions({pAct:1,actions:[{name:'adjust_volume',arguments:{direction:'down',by:23}}]}),[{type:'volume_delta',value:-23}])
})

test('volume actions clamp; shutdown is confirmed and expires; unsupported cannot poweroff',()=>{
  let time=1000,volume=95,powered=0,stopped=0,qr=0
  const control=createVoiceCommandController({now:()=>time,getVolume:()=>({percent:volume}),setVolume:v=>volume=v,openQR:()=>qr++,stopAI:()=>stopped++})
  assert.equal(control.handleText('音量を上げて').handled,true)
  assert.equal(volume,100)
  assert.equal(control.handleText('音量を下げて').handled,true)
  assert.equal(volume,90)
  assert.equal(control.handleText('サイトのQRを出して').handled,true)
  assert.equal(qr,1)
  assert.equal(control.handleText('AIモードをオフにして').handled,true)
  assert.equal(stopped,1)
  assert.equal(control.handleText('シャットダウンして').handled,true)
  assert.equal(control.pendingShutdown(),true)
  time += 10001
  assert.equal(control.handleText('シャットダウン実行').handled,false)
  assert.equal(powered,0)
  assert.equal(control.handleText('シャットダウンして').handled,true)
  const result=control.handleText('シャットダウン実行')
  assert.equal(result.handled,true)
  assert.match(result.message,/実装されていません/)
  assert.equal(control.pendingShutdown(),false)
  const withPower=createVoiceCommandController({now:()=>time,powerOff:()=>powered++})
  withPower.handleText('シャットダウンして')
  withPower.handleText('キャンセル')
  assert.equal(withPower.handleText('シャットダウン実行').handled,false)
  assert.equal(powered,0)
  withPower.handleText('シャットダウンして')
  withPower.handleText('シャットダウン実行')
  assert.equal(powered,1)
})

test('KoeAct action execution is gated and executes only validated supported actions',()=>{
  let volume=20,moved='',expression='',led
  const control=createVoiceCommandController({getVolume:()=>({percent:volume}),setVolume:v=>volume=v,moveHead:d=>moved=d,setExpression:e=>expression=e,setLED:c=>led=c})
  assert.equal(control.handleKoeAct({pAct:.96,actions:[{name:'set_volume',arguments:{level:90}}]}).handled,false)
  assert.equal(volume,20)
  const result=control.handleKoeAct({pAct:.99,actions:[{name:'set_volume',arguments:{level:37}},{name:'look',arguments:{direction:'left',degrees:45}}]})
  assert.equal(result.handled,true)
  assert.equal(volume,37)
  assert.equal(moved,'left')
  assert.equal(control.handleKoeAct({pAct:.99,actions:[{name:'set_expression',arguments:{expression:'happy'}},{name:'set_led',arguments:{color:'green'}}]}).handled,true)
  assert.equal(expression,'happy')
  assert.deepEqual(led,[0,96,0])
})
