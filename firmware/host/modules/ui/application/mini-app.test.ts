import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MiniAppRegistry } from './mini-app.ts'

const content = {} as never

test('MiniAppRegistry validates, sorts, and unregisters definitions', () => {
  const registry = new MiniAppRegistry()
  let notifications = 0
  registry.subscribe(() => {
    notifications += 1
  })

  const unregisterZulu = registry.register({ id: 'sample.zulu', title: 'Zulu', create: () => content })
  registry.register({ id: 'sample.alpha', title: ' Alpha ', create: () => content })

  assert.deepEqual(
    registry.list().map(({ id, title }) => ({ id, title })),
    [
      { id: 'sample.alpha', title: 'Alpha' },
      { id: 'sample.zulu', title: 'Zulu' },
    ],
  )
  assert.equal(notifications, 2)

  unregisterZulu()
  unregisterZulu()
  assert.deepEqual(
    registry.list().map(({ id }) => id),
    ['sample.alpha'],
  )
  assert.equal(notifications, 3)
})

test('MiniAppRegistry rejects invalid and duplicate definitions', () => {
  const registry = new MiniAppRegistry()
  registry.register({ id: 'valid-app', title: 'Valid', create: () => content })

  assert.throws(() => registry.register({ id: 'Not Valid', title: 'Invalid', create: () => content }), /mini app id/)
  assert.throws(() => registry.register({ id: 'empty-title', title: '   ', create: () => content }), /mini app title/)
  assert.throws(
    () => registry.register({ id: 'valid-app', title: 'Duplicate', create: () => content }),
    /already registered/,
  )
})

test('registry snapshots metadata without exposing the create callback', () => {
  const registry = new MiniAppRegistry()
  registry.register({ id: 'sample', title: 'Sample', create: () => content })
  const listed = registry.list()[0] as Record<string, unknown>

  assert.equal(Object.isFrozen(listed), true)
  assert.equal('create' in listed, false)
})


test('availability changes keep entries visible and notify listeners only on change', () => {
  const registry = new MiniAppRegistry()
  let notifications = 0
  registry.subscribe(() => { notifications++ })
  registry.register({ id: 'camera', title: 'Camera', create: () => content })
  assert.equal(registry.setAvailability('camera', false, 'カメラを使用できません'), true)
  assert.equal(registry.list()[0].unavailableReason, 'カメラを使用できません')
  assert.equal(registry.setAvailability('camera', false, 'カメラを使用できません'), true)
  assert.equal(notifications, 2)
  assert.equal(registry.setAvailability('camera', true), true)
  assert.equal(registry.list()[0].unavailableReason, undefined)
  assert.equal(notifications, 3)
  assert.equal(registry.setAvailability('missing', false), false)
})

test('dynamic availability changes and recovers without removing the mini app', () => {
  const registry = new MiniAppRegistry()
  let connected = false
  registry.register({
    id: 'cloud',
    title: 'Cloud',
    availability: () => connected ? undefined : 'Wi-Fi未接続',
    create: () => content,
  })
  registry.refreshAvailability()
  assert.equal(registry.list()[0].unavailableReason, 'Wi-Fi未接続')
  connected = true
  registry.refreshAvailability()
  assert.equal(registry.list()[0].unavailableReason, undefined)
})

test('availability predicate failure disables only the affected mini app', () => {
  const registry = new MiniAppRegistry()
  registry.register({ id: 'broken', title: 'Broken', availability: () => { throw new Error('offline') }, create: () => content })
  registry.register({ id: 'timer', title: 'Timer', create: () => content })
  registry.refreshAvailability()
  assert.equal(registry.unavailableReason('broken'), '機能の状態を確認できません')
  assert.equal(registry.unavailableReason('timer'), undefined)
})
