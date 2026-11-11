import type { PreferenceConfig } from 'loadPreference'
import type { StackchanContext } from 'capabilities'

export { runLaunchBehaviors } from 'app-launch'

export type StackchanAppBehaviorOption = {
  device?: unknown
  config: PreferenceConfig
}

export type StackchanAppBehavior = {
  onLaunch?: () => Promise<boolean> | boolean
  onContextCreated?: (context: StackchanContext, option: StackchanAppBehaviorOption) => Promise<void> | void
}

export async function runContextCreatedBehaviors(
  behaviors: StackchanAppBehavior[],
  context: StackchanContext,
  option: StackchanAppBehaviorOption,
): Promise<void> {
  for (let index = 0; index < behaviors.length; index++) {
    const behavior = behaviors[index]
    if (!behavior.onContextCreated) continue
    trace(`[startup] behavior=${index} hook=onContextCreated state=begin\\n`)
    try {
      await behavior.onContextCreated(context, option)
      trace(`[startup] behavior=${index} hook=onContextCreated state=ready\\n`)
    } catch (error) {
      const kind = error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : typeof error
      trace(`[startup] behavior=${index} hook=onContextCreated state=failed error=${kind}\\n`)
      throw error
    }
  }
}
