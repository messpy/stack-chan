import { createContextInitializer, createAsyncContextInitializer, type StartupComponentEvent, type StartupComponent, type StartupComponentState, type StartupScreenDiagnostics } from 'context-startup'
import loadPreferences, { loadModConfig, loadPreferenceConfig } from 'loadPreference'
import System from 'embedded:system'
import { runContextCreatedBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppBehaviors } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { installLaunchShortcut, type LaunchShortcutButton, prepareAppLaunch } from 'app-launch'
import { type BootWiFiStatus, startHostBootServices } from 'boot-services'
import { classifyBootWiFiFailure, waitForBootWiFiRecoveryChoiceWithTimeout } from 'boot-network-recovery'
import type { StackchanContext } from 'capabilities'
import { createStackchanContext, getHostDeviceEnvironment } from 'compose'
import { DOMAIN } from 'consts'
import { type StackchanDockRuntime, startStackchanDock } from 'dock'
import { prepareExperimentalMiniApps, registerExperimentalMiniApps } from 'experimental-mini-app-loader'
import { initializeLocalization } from 'localization'
import Modules from 'modules'
import {
  type StartupPhase,
  showStartupError,
  showStartupSplash,
  showWiFiConnectionStatus,
  showWiFiRecoveryChoice,
  startupErrorClass,
} from 'startup-splash'
import { applyTimezone } from 'timezone-settings'
import Timer from 'timer'

type DeviceButton = {
  onChanged: (this: DeviceButton) => void
}

type GlobalEnvironment = {
  application?: ReturnType<typeof showStartupSplash>
  button?: Partial<Record<'a' | 'c', DeviceButton>> & { power?: LaunchShortcutButton }
}

const globalEnv = globalThis as typeof globalThis & GlobalEnvironment
const noopButtonHandler = () => undefined

function installPlatformInputBridge(): void {
  if (!Modules.has('wasm-button-bridge')) return
  const bridge = Modules.importNow('wasm-button-bridge') as { installWasmButtons?: () => void }
  bridge.installWasmButtons?.()
  trace('[main] installed WASM button bridge\n')
}

function loadAppBehaviors(): StackchanAppBehavior[] {
  trace('[main] checking mod override\n')
  return resolveAppBehaviors(Modules, defaultBehavior, (error) => {
    trace(`[main] MOD override unavailable: ${startupErrorClass(error)}\n`)
  })
}

function installModManagerShortcut(): void {
  const powerButton = globalEnv.button?.power
  if (!powerButton || !Modules.has('mod-manager')) return
  installLaunchShortcut(powerButton, async () => {
    try {
      const startModManager = Modules.importNow('mod-manager') as (
        application: ReturnType<typeof showStartupSplash>,
      ) => Promise<'back'>
      await startModManager(globalEnv.application ?? showStartupSplash())
      System.restart?.()
    } catch (error) {
      trace(`[mods] shortcut failed: ${startupErrorClass(error)}\n`)
    }
  })
}

function waitForBootWiFiRecoveryChoice(status: BootWiFiStatus & { reason: string }): Promise<'retry' | 'offline'> {
  const previousAHandler = globalEnv.button?.a?.onChanged
  const previousCHandler = globalEnv.button?.c?.onChanged
  const restoreButtons = () => {
    if (globalEnv.button?.a) globalEnv.button.a.onChanged = previousAHandler ?? noopButtonHandler
    if (globalEnv.button?.c) globalEnv.button.c.onChanged = previousCHandler ?? noopButtonHandler
  }
  return waitForBootWiFiRecoveryChoiceWithTimeout(
    Timer,
    (choose) => {
      trace(`[network] recovery prompt: ${classifyBootWiFiFailure(status.reason)}\n`)
      showWiFiRecoveryChoice({
        message: status.message,
        onRetry: () => choose('retry'),
        onOffline: () => choose('offline'),
      })
      if (globalEnv.button?.a) globalEnv.button.a.onChanged = () => choose('retry')
      if (globalEnv.button?.c) globalEnv.button.c.onChanged = () => choose('offline')
    },
    restoreButtons,
    15000,
    () => trace('[network] recovery deadline; starting offline\n'),
  )
}

async function main() {
  let startupCheckpoint: ((phase: string, error?: unknown, component?: StartupComponent, state?: StartupComponentState) => void) | undefined
  let startupSnapshot: (() => StartupScreenDiagnostics | undefined) | undefined
  let phase: StartupPhase = 'initialization'
  let startupComponent: StartupComponent = 'none'
  let startupFailureRecorded = false
  const markStartup = (phase: string, error?: unknown, component: StartupComponent = 'none', state: StartupComponentState = 'begin') => { try { startupCheckpoint?.(phase, error, component, state) } catch {} }
  const reportStartup = (event: StartupComponentEvent) => {
    if (startupFailureRecorded) return
    startupComponent = event.component
    startupFailureRecorded = event.state === 'failed'
    markStartup(phase, event.error, event.component, event.state)
  }
  const initialize = createContextInitializer(reportStartup)
  const initializeAsync = createAsyncContextInitializer(reportStartup)
  try {
    if (Modules.has('archive-debug')) {
      const diagnostics = Modules.importNow('archive-debug') as { installDebugLog: () => void; recordStartupCheckpoint?: typeof startupCheckpoint; startupDiagnosticSnapshot?: typeof startupSnapshot }
      diagnostics.installDebugLog()
      startupCheckpoint = diagnostics.recordStartupCheckpoint
      startupSnapshot = diagnostics.startupDiagnosticSnapshot
      markStartup('initialization')
    }
  } catch { trace('[debug] log initialization unavailable\n') }
  try {
    if (Modules.has('archive-screen')) (Modules.importNow('archive-screen') as { installScreenCapture: () => void }).installScreenCapture()
  } catch { trace('[screen] capture initialization unavailable\n') }
  trace('[main] start\n')
  let dockRuntime: StackchanDockRuntime | undefined
  let context: StackchanContext | undefined
  try {
    dockRuntime = startStackchanDock(Modules, loadModConfig())
    if (dockRuntime) trace('[main] Stackchan Dock started\n')
    installPlatformInputBridge()
    initializeLocalization(loadPreferences(DOMAIN.ui).language)
    applyTimezone(loadPreferences(DOMAIN.time).timezone)

    trace('[main] loading app behaviors\n')
    const appBehaviors = loadAppBehaviors()
    // Launch behaviors run before startHostBootServices so the splash screen is
    // visible while network setup blocks.
    phase = 'launch'
    markStartup(phase)
    const launch = await prepareAppLaunch(appBehaviors, prepareExperimentalMiniApps)
    trace(`[main] onLaunch shouldCreateContext=${launch.shouldCreateContext}\n`)
    if (!launch.shouldCreateContext) {
      installModManagerShortcut()
      const unownedDock = dockRuntime
      dockRuntime = undefined
      unownedDock?.close()
      return
    }
    const experimentalMiniApps = launch.prepared

    phase = 'network'
    markStartup(phase)
    const bootServices = startHostBootServices({
      wifi: {
        onStatusChanged: showWiFiConnectionStatus,
        promptRecoveryChoice: waitForBootWiFiRecoveryChoice,
      },
    })
    const networkReady = await bootServices.connectivity.network.ready
    trace(`[main] network ready: ${networkReady.status}\n`)
    phase = 'context'
    markStartup(phase)
    const preferences = initialize('preferences', loadPreferenceConfig)
    const ownedDock = dockRuntime
    context = createStackchanContext(preferences, {
      initialize,
      connectivity: bootServices.connectivity,
      remoteConversationSession: ownedDock?.remoteConversationSession,
      closeHandlers: ownedDock ? [() => ownedDock.close()] : undefined,
    })
    phase = 'behavior'
    markStartup(phase)
    initialize('dock-context', () => ownedDock?.onContextCreated(context!))
    initialize('experimental-miniapps', () => registerExperimentalMiniApps(experimentalMiniApps, context!.ui.miniApps))
    trace('[main] app context created\n')
    await initializeAsync('context-behaviors', () => runContextCreatedBehaviors(appBehaviors, context!, {
      initialize,
      device: getHostDeviceEnvironment(),
      config: preferences,
    }))
    if (Modules.has('lan-archive')) {
      const archive = initialize('archive-import', () => Modules.importNow('lan-archive')) as { startArchive: (context: StackchanContext, initialize?: typeof initialize) => void }
      initialize('archive-start', () => archive.startArchive(context!, initialize))
    }
    trace('[main] app behaviors ready\n')
    initialize('mod-shortcut', installModManagerShortcut)
    markStartup('ready')
  } catch (error) {
    // Save failure before cleanup, which can itself fail or block.
    if (!startupFailureRecorded) markStartup(phase, error, startupComponent, 'failed')
    let diagnostic: StartupScreenDiagnostics | undefined
    try { diagnostic = startupSnapshot?.() } catch {}
    // A newer/disposed view during async cleanup owns its screen. Do not
    // replace it with an older startup attempt's failure.
    const failedApplication = globalEnv.application
    const failedBehavior = failedApplication?.behavior
    const failedContent = failedApplication?.first
    try {
      if (context) await context.lifecycle.close()
      else dockRuntime?.close()
    } catch (closeError) {
      trace(`[main] cleanup error ${startupErrorClass(closeError)}\n`)
    }
    trace(`[main] startup failed phase=${phase} error=${startupErrorClass(error)}\n`)
    trace(`[main] startup detail: ${error instanceof Error ? error.message : 'unknown'}\n`)
    if (
      globalEnv.application === failedApplication &&
      (!failedApplication ||
        (failedApplication.behavior === failedBehavior && failedApplication.first === failedContent))
    ) {
      try {
        showStartupError({ phase, error, diagnostic, onRestart: () => System.restart?.() })
        installModManagerShortcut()
      } catch (displayError) {
        trace(`[main] startup error display failed ${startupErrorClass(displayError)}\n`)
      }
    }
    throw error
  }
}

void main().catch(() => undefined)
