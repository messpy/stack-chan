import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync(new URL('../../host/app/archive-camera-handoff.js',import.meta.url), 'utf8')
const {createCameraHandoff} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))

{
  const events = []
  let release
  const block = new Promise(resolve => {release=resolve})
  const handoff = createCameraHandoff({
    async suspend() {events.push('suspend')},
    async capture(args) {events.push('capture');await block;return {image:args.image}},
    async settle(outcome) {events.push(outcome.status)},
  })
  const first=handoff.run({image:'test.jpg'})
  assert.equal(handoff.active,true)
  await assert.rejects(handoff.run({image:'duplicate.jpg'}), /Camera busy/)
  release()
  assert.deepEqual(await first,{image:'test.jpg'})
  assert.equal(handoff.active,false)
  assert.deepEqual(events,['suspend','capture','complete'])
}

for(const stage of ['suspend','capture']){
  const events=[]
  const handoff=createCameraHandoff({
    async suspend(){events.push('suspend');if(stage==='suspend')throw Error('pause failed')},
    async capture(){events.push('capture');throw Error('frame unavailable')},
    async settle(outcome){events.push(outcome.status);assert.equal(outcome.status,'failed')},
  })
  await assert.rejects(handoff.run({}), /pause failed|frame unavailable/)
  assert.equal(handoff.active,false)
  assert.deepEqual(events, stage==='suspend'?['suspend','failed']:['suspend','capture','failed'])
}

console.log('PASS: camera handoff serializes requests, suspends audio first, and settles on success/failure')
