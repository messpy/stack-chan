import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source=fs.readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
const start=source.indexOf('    async function executeTool(name, args) {')
const end=source.indexOf('    async function recognitionTurn(text)',start)
assert.ok(start>=0&&end>start,'executeTool is present')
const implementation=source.slice(start,end)

function harness() {
  const calls=[]
  const context={
    instance:{},chat:null,recognitionTurnCurrent:()=>false,
    visualAllowed:false,headHandled:undefined,photoHandler:async()=>undefined,
    memoryTools:[],callDeviceTool:(name,args)=>{calls.push({name,args});return {commanded:true,direction:args.direction}},
    trace:()=>{}
  }
  context.chat=context.instance
  const executeTool=vm.runInNewContext(implementation+'\nexecuteTool',context)
  return {context,calls,executeTool}
}

test('confirmed local head motion is reused without moving twice',async()=>{
  const h=harness()
  h.context.headHandled={direction:'right',promise:Promise.resolve({commanded:true,direction:'right'})}
  const result=await h.executeTool('head_move',{direction:'right'})
  assert.equal(result.commanded,true)
  assert.equal(result.duplicate,true)
  assert.equal(result.direction,'right')
  assert.equal(h.context.headHandled,undefined)
  assert.equal(h.calls.length,0)
})

test('failed or unconfirmed local head motion never reports success to the AI',async()=>{
  const h=harness()
  const rejected=Promise.reject(Error('servo bus unavailable'))
  rejected.catch(()=>{})
  h.context.headHandled={direction:'up',promise:rejected}
  await assert.rejects(h.executeTool('head_move',{direction:'up'}),/servo bus unavailable/)
  h.context.headHandled={direction:'up',promise:Promise.resolve({commanded:false})}
  await assert.rejects(h.executeTool('head_move',{direction:'up'}),/首振り動作が完了していません/)
  assert.equal(h.calls.length,0)
})

test('different head direction takes a distinct motor path',async()=>{
  const h=harness()
  h.context.headHandled={direction:'right',promise:Promise.resolve({commanded:true,direction:'right'})}
  const result=await h.executeTool('head_move',{direction:'left'})
  assert.equal(result.direction,'left')
  assert.equal(h.calls.length,1)
  assert.equal(h.calls[0].name,'head_move')
})

test('an unrequested camera call is denied before capture',async()=>{
  const h=harness()
  let captures=0
  h.context.photoHandler=async()=>{captures++;return {}}
  const result=await h.executeTool('camera_describe',{})
  assert.match(result.error,/撮影を依頼していません/)
  assert.equal(captures,0)
})

test('authorized camera call runs once and consumes authorization',async()=>{
  const h=harness()
  let captures=0
  h.context.visualAllowed=true
  h.context.photoHandler=async()=>{captures++;return {image:'photo-1.jpg',analysis:{status:'complete',text:'机'}}}
  const result=await h.executeTool('camera_describe',{question:'何がある？'})
  assert.equal(result.photo,'photo-1.jpg')
  assert.equal(result.description,'机')
  assert.equal(captures,1)
  assert.equal(h.context.visualAllowed,false)
  await h.executeTool('camera_describe',{})
  assert.equal(captures,1)
})
