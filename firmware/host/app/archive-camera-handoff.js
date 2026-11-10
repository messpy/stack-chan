// Execute a camera tool after detaching the audio connection.
// Keep the handoff active through cleanup so the voice retry loop cannot race.
export function createCameraHandoff({suspend, capture, settle}) {
  let active = false
  return {
    get active() { return active },
    async run(args) {
      if (active) throw new Error('Camera busy')
      active = true
      let outcome = {status:'failed'}
      try {
        await suspend()
        const result = await capture(args)
        outcome = {status:'complete', result}
        return result
      } catch (error) {
        outcome = {status:'failed', error}
        throw error
      } finally {
        try { await settle(outcome) }
        finally { active = false }
      }
    },
  }
}
