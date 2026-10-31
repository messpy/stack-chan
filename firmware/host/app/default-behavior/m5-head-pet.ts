// Petting rules ported from m5stack/StackChan, firmware/main/stackchan/modifiers/head_pet.h.
// Original: Copyright (c) 2026 M5Stack Technology CO LTD, MIT.
export type PetRotation = { y: number; p: number; r: number }
export type PetMotion = { rotation: PetRotation; speed: number; action: number }
const SCALE = 1800 / Math.PI
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const integer = (random: () => number, min: number, max: number) => min + Math.floor(random() * (max - min + 1))

// Match the factory critically damped spring's 98% settling time on the duration-based driver.
export function m5MotionDurationSeconds(speed: number): number {
  const normalized = clamp(speed, 0, 1000) / 1000
  return 5.834 / Math.sqrt(10 + normalized * normalized * 640)
}

export function makeM5PetMotion(base: PetRotation, random = Math.random): PetMotion {
  const action = integer(random, 0, 2)
  const speed = integer(random, 300, 500)
  let yaw = base.y * SCALE
  let pitch = -base.p * SCALE
  if (action === 0) {
    pitch += integer(random, 150, 250)
    yaw += integer(random, -50, 50)
  } else if (action === 1) {
    pitch -= integer(random, 0, 50)
    yaw += integer(random, 0, 1) === 0 ? 150 : -150
  } else {
    pitch += integer(random, 250, 400)
  }
  return { rotation: { y: clamp(yaw, -512, 512) / SCALE, p: -clamp(pitch, 0, 540) / SCALE, r: base.r }, speed, action }
}

export function createM5HeadPetController<T extends { rotation: PetRotation }>(options: {
  snapshot: () => T
  happy: (durationMs: number) => void
  move: (motion: PetMotion) => Promise<void>
  restore: (state: T) => void
  schedule: (callback: () => void, delayMs: number) => () => void
  error: (error: unknown) => void
  canMove?: () => boolean
  random?: () => number
}) {
  let original: T | undefined
  let cancelRestore: (() => void) | undefined
  let moving = false
  const random = options.random ?? Math.random
  return {
    get active() { return original !== undefined },
    handle(gesture: string) {
      if (gesture === 'forwardSwipe' || gesture === 'backwardSwipe') {
        original ??= options.snapshot()
        cancelRestore?.()
        cancelRestore = undefined
        options.happy(integer(random, 1500, 2500))
        if (!moving && (options.canMove?.() ?? true)) {
          moving = true
          try {
            void options.move(makeM5PetMotion(original.rotation, random)).then(
              () => { moving = false },
              (error) => { moving = false; options.error(error) },
            )
          } catch (error) { moving = false; options.error(error) }
        }
      } else if (gesture === 'release' && original !== undefined) {
        cancelRestore?.()
        cancelRestore = options.schedule(() => {
          const state = original
          original = undefined
          cancelRestore = undefined
          if (state !== undefined) options.restore(state)
        }, 3000)
      }
    },
  }
}
