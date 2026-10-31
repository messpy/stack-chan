import assert from 'node:assert/strict'
import test from 'node:test'
import { createM5HeadPetController, makeM5PetMotion, type PetMotion } from './m5-head-pet.js'

function fixture() {
  let now = 0
  const pending = new Set<{ due: number; run: () => void }>()
  const original = { emotion: 'neutral', rotation: { y: 0.1, p: -0.2, r: 0 } }
  const happy: number[] = []
  const restored: typeof original[] = []
  const moves: PetMotion[] = []
  const controller = createM5HeadPetController({
    snapshot: () => ({ ...original, rotation: { ...original.rotation } }),
    happy: (duration) => { happy.push(duration) },
    move: async (motion) => { moves.push(motion) },
    restore: (state) => { restored.push(state) },
    error: (error) => { throw error },
    random: () => 0.5,
    schedule: (run, delay) => {
      const job = { due: now + delay, run }
      pending.add(job)
      return () => { pending.delete(job) }
    },
  })
  return { controller, original, happy, restored, moves,
    advance(ms: number) {
      now += ms
      for (const job of [...pending]) if (job.due <= now) { pending.delete(job); job.run() }
    },
  }
}

test('one stroke in either direction reacts, holding waits for release', () => {
  for (const direction of ['forwardSwipe', 'backwardSwipe']) {
    const f = fixture()
    f.controller.handle('press')
    assert.equal(f.happy.length, 0)
    f.controller.handle(direction)
    assert.equal(f.happy.length, 1)
    assert.equal(f.moves.length, 1)
    assert.ok(f.happy[0] >= 1500 && f.happy[0] <= 2500)
    f.advance(10000)
    assert.equal(f.restored.length, 0)
    f.controller.handle('release')
    f.advance(2999)
    assert.equal(f.restored.length, 0)
    f.advance(1)
    assert.deepEqual(f.restored, [f.original])
    assert.equal(f.controller.active, false)
  }
})

test('a new stroke cancels restoration and retains the original pose', () => {
  const f = fixture()
  f.controller.handle('forwardSwipe')
  f.controller.handle('release')
  f.advance(2000)
  f.controller.handle('backwardSwipe')
  f.advance(10000)
  assert.equal(f.restored.length, 0)
  f.controller.handle('release')
  f.advance(3000)
  assert.deepEqual(f.restored, [f.original])
})

test('tap and release alone do not start a pet reaction', () => {
  const f = fixture()
  f.controller.handle('press')
  f.controller.handle('release')
  f.advance(5000)
  assert.deepEqual(f.happy, [])
  assert.deepEqual(f.moves, [])
  assert.deepEqual(f.restored, [])
})

test('all three factory motion choices stay within the specified angle envelope', () => {
  const actions = new Set<number>()
  for (let i = 0; i < 100; i++) {
    const motion = makeM5PetMotion({ y: 3, p: -2, r: 0 }, () => i / 100)
    actions.add(motion.action)
    assert.ok(Math.abs(motion.rotation.y) <= 51.2 * Math.PI / 180 + 1e-12)
    assert.ok(motion.rotation.p <= 0 && motion.rotation.p >= -54 * Math.PI / 180 - 1e-12)
    assert.ok(motion.speed >= 300 && motion.speed <= 500)
  }
  assert.deepEqual([...actions], [0, 1, 2])
})
