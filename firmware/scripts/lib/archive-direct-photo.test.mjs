import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=readFileSync(new URL('../../host/app/archive-direct-photo.js',import.meta.url),'utf8')
const {directPhotoRequest}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'))

test('explicit commands use local camera only',()=>{
  for(const text of ['写真撮って。','写真を撮って','写真を一枚撮って','写真を1枚撮って','スタックチャン、写真撮って','スタックちゃん 写真を撮って','カメラで写真を撮影してください'])
    assert.equal(directPhotoRequest(text),true,text)
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
  assert.ok(body.indexOf('closeChat()')>=0)
  assert.ok(body.indexOf('closeChat()')<body.indexOf('photoHandler({analyze:false})'))
  assert.match(body,/retryAt=Date\.now\(\)\+30000/)
  assert.match(body,/finally\s*\{/)
  assert.match(body,/retryAt=Date\.now\(\)\+1000/)
  assert.match(lan,/args=>photo\(robot,\{\.\.\.args,analyze:args\?\.analyze!==false\},true\)/)
  assert.match(lan,/robot\.camera\.close\(\)/)
})
