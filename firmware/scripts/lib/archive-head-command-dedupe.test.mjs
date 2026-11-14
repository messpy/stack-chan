import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source=readFileSync(new URL('../../host/app/archive-direct-chat.js',import.meta.url),'utf8')
const start=source.indexOf('    async function executeTool(name, args) {')
const end=source.indexOf('    async function recognitionTurn(text)',start)
assert.ok(start>=0&&end>start,'device tool dispatch exists')
const toolSource=source.slice(start,end)

function setup(existing) {
  let movements=0
  const context={
    instance:{},chat:null,recognitionTurnCurrent:()=>false,
    headHandled:existing,
    visualAllowedUntil:0,volumeAllowedUntil:0,
    photoHandler:null,photoTurn:null,memoryTools:[],
    trace(){},Date,Promise,
    callDeviceTool:async(name,args)=>{
      if(name!=='head_move')throw Error('unexpected tool')
      movements++
      return {commanded:true,direction:args.direction}
    }
  }
  context.chat=context.instance
  return {context,exec:vm.runInNewContext(toolSource+'\nexecuteTool',context),movements:()=>movements}
}

test('one AI head move per utterance, including repeated provider tool calls',async()=>{
  const h=setup()
  const first=await h.exec('head_move',{direction:'up'})
  const second=await h.exec('head_move',{direction:'up'})
  const third=await h.exec('head_move',{direction:'up'})
  assert.equal(h.movements(),1)
  assert.equal(first.commanded,true)
  assert.equal(second.duplicate,true)
  assert.equal(third.duplicate,true)
  await assert.rejects(h.exec('head_move',{direction:'down'}),/異なる首振り/)
  assert.equal(h.movements(),1)
})

test('already started physical head command is reused by AI without a second motion',async()=>{
  let finish
  const pending=new Promise(resolve=>{finish=resolve})
  const h=setup({direction:'right',promise:pending})
  const future=h.exec('head_move',{direction:'right'})
  finish({commanded:true,direction:'right'})
  const result=await future
  assert.equal(result.direction,'right')
  assert.equal(result.duplicate,true)
  assert.equal(h.movements(),0)
})

test('a failed head motion is never reported as physically verified',async()=>{
  const h=setup({direction:'up',promise:Promise.resolve({commanded:false})})
  await assert.rejects(h.exec('head_move',{direction:'up'}),/完了していません/)
  assert.equal(h.movements(),0)
})
