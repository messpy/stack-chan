/** Stable scalar IDs shared by context startup, USB/RTC diagnostics and the failure screen. */
export const STARTUP_COMPONENTS = [
  'none', 'preferences', 'selection', 'driver', 'ui', 'tts', 'touch', 'head-touch',
  'touch-panel', 'imu', 'microphone', 'camera', 'speaker', 'media', 'led', 'runtime',
  'runtime-motion', 'runtime-ui', 'runtime-audio', 'runtime-input', 'runtime-camera',
  'runtime-lighting', 'runtime-timer',
] as const
export type StartupComponent = (typeof STARTUP_COMPONENTS)[number]
export type StartupComponentState = 'begin' | 'done' | 'failed'
export type ContextInitializer = <T>(component: StartupComponent, create: () => T) => T
export type StartupComponentEvent = {
  component: StartupComponent
  state: StartupComponentState
  error?: unknown
}

export function createContextInitializer(report?: (event: StartupComponentEvent) => void): ContextInitializer {
  let failed = false
  const notify = (event: StartupComponentEvent) => { try { report?.(event) } catch { /* Observation cannot alter initialization. */ } }
  return <T>(component: StartupComponent, create: () => T): T => {
    notify({ component, state: 'begin' })
    try {
      const value = create()
      notify({ component, state: 'done' })
      return value
    } catch (error) {
      // The deepest failing step owns the evidence. Outer scopes preserve the same exception.
      if (!failed) { failed = true; notify({ component, state: 'failed', error }) }
      throw error
    }
  }
}

export type StartupScreenDiagnostics = {
  component?: unknown
  reason?: unknown
  internalFree?: unknown
  internalLargest?: unknown
  psramFree?: unknown
}
export function startupDiagnosticLines(value?: StartupScreenDiagnostics): string[] {
  if (!value || !STARTUP_COMPONENTS.includes(value.component as StartupComponent)) return []
  const reason = ['none', 'memory', 'storage', 'network', 'unclassified'].includes(String(value.reason)) ? value.reason : 'unclassified'
  const result = [String(value.component) + ' / ' + String(reason)]
  const fields = [value.internalFree, value.internalLargest, value.psramFree]
  if (fields.every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) {
    result.push('RAM ' + fields[0] + ' / ' + fields[1] + '  PS ' + fields[2])
  }
  return result
}
