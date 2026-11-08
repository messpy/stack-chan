import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=readFileSync(new URL('../../host/app/archive-direct-photo.js',import.meta.url),'utf8')
const {directPhotoRequest}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'))

test('explicit commands use local camera only',()=>{
  for(const text of ['写真撮って。','写真を撮って','写真を一枚撮って','写真を1枚撮って','スタックチャン、写真撮って','スタックちゃん 写真を撮って','マックちゃん写真撮って。','マックチャン、写真を撮って','カメラで写真を撮影してください'])
    assert.equal(directPhotoRequest(text),true,text)
})
test('camera-only PR #47/#55 voice variants are accepted without cloud analysis',()=>{
  for(const line of [
    '撮影して', '撮影してください', 'カメラで撮って',
    'カメラを撮影して', '写真を撮ってね', '写真撮ってお願い',
    'ねぇ、写真を撮って', 'スタックチャン、写真を一枚撮って',
    'カメラで写真を1枚撮って'
  ]) assert.equal(directPhotoRequest(line),true,line)
})
test('historical, quoted and negated camera requests are never authorized',()=>{
  for(const line of [
    '昨日写真を撮ってと言った', '「写真を撮って」',
    '写真を撮ってとは言ってない', '写真を撮らないでください',
    'カメラで撮ってもいい？', 'カメラで見てください',
    '写真撮影の話をした', '写真を撮ってから送信して',
    'スタックチャンに写真を撮ってと言われた'
  ]) assert.equal(directPhotoRequest(line),false,line)
})
test('mentions, questions, negative or ambiguous text never trigger camera',()=>{
  for(const text of ['写真を撮らないで','写真を撮ってほしくない','写真撮ってと言った','写真が撮れる？','さっき写真を撮って','写真を撮って、そのあと送って','顔を見て','説明して','写真','',null,'写真撮って '.repeat(30)])
    assert.equal(directPhotoRequest(text),false,String(text))
})
test('XiaoZhi resources are closed before local photo and analysis is disabled',()=>{
  const chat=readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
  const lan=readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
  const start=chat.indexOf('if (directPhotoRequest(recognized))')
  const end=chat.indexOf('// A short, explicit physical command',start)
  const body=chat.slice(start,end)
  assert.ok(start>=0&&end>start)
  assert.match(body,/beginCameraHandoff\(\)/)
  assert.ok(body.indexOf('beginCameraHandoff()')<body.indexOf('photoHandler({analyze:false})'))
  assert.match(chat,/export function beginCameraHandoff\(\)[\s\S]*?pauseDirectChat\(\)/)
  assert.match(chat,/export function pauseDirectChat\(\)[\s\S]*?closeChat\(\)/)
  assert.match(body,/finally\s*\{[\s\S]*finishCameraHandoff\(\)/)
  assert.match(lan,/args=>photo\(robot,\{\.\.\.args,analyze:args\?\.analyze!==false\},true\)/)
  assert.match(lan,/robot\.camera\.close\(stage=>markPhotoPhase\(stage\)\)/)
})

test('cloud camera tool cannot allocate native camera while voice owns internal SRAM',()=>{
  const chat=readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
  const start=chat.indexOf("if (name === 'camera_describe')")
  const end=chat.indexOf('if (memoryTools.some(',start)
  const body=chat.slice(start,end)
  assert.ok(start>=0 && end>start)
  assert.match(body,/if \(chat === instance\)/)
  assert.match(body,/CAMERA_BLOCKED/)
  assert.ok(body.indexOf('return {error:')>=0 && body.indexOf('return {error:')<body.indexOf('photoHandler(args)'))
})


test('PR #55 camera failure classification remains sanitized in both USB status lanes',()=>{
  const lan=readFileSync(new URL('../../host/app/lan-archive.js',import.meta.url),'utf8')
  const start=lan.indexOf('function cameraFailureClass(error){')
  const end=lan.indexOf('function photoDiagnostic(){',start)
  assert.ok(start>=0 && end>start)
  const classifierSource=lan.slice(start,end)
  const classify=new Function(classifierSource+';return cameraFailureClass')()
  assert.equal(classify(new Error('not enough memory for camera')),'memory')
  assert.equal(classify(new Error('SCCB sensor probe failed')),'sensor-bus')
  assert.equal(classify(new Error('camera busy')),'busy')
  assert.equal(classify(new Error('camera timeout')),'timeout')
  assert.equal(classify(new Error('camera unavailable')),'unavailable')
  assert.equal(classify(new Error('internal secret error')),'unknown')
  assert.equal((lan.match(/watchdogStage:photoRecoveryLastCheckpoint\(\),\.\.\.photoDiagnostic\(\)/g)||[]).length,3)
  assert.match(lan,/photoErrorClass=cameraFailureClass\(error\)/)
  assert.match(lan,/photoErrorStage=photoProgress/)
})
