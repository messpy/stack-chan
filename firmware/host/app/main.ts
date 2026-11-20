import loadPreferences, { loadModConfig, loadPreferenceConfig } from 'loadPreference'
import System from 'embedded:system'
import { runContextCreatedBehaviors, type StackchanAppBehavior } from 'app-behavior'
import { resolveAppBehaviors } from 'app-behavior-resolver'
import defaultBehavior from 'app-default-behavior'
import { installLaunchShortcut, type LaunchShortcutButton, prepareAppLaunch } from 'app-launch'
import { makeStartupFailureRecord, makeStartupProgressRecord } from 'startup-diagnostics'
import { importOptionalArchive } from 'optional-archive-import'
import { type BootWiFiStatus, startHostBootServices } from 'boot-services'
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
  return new Promise((resolve) => {
    let resolved = false
    const previousAHandler = globalEnv.button?.a?.onChanged
    const previousCHandler = globalEnv.button?.c?.onChanged

    const restoreButtons = () => {
      if (globalEnv.button?.a) {
        globalEnv.button.a.onChanged = previousAHandler ?? noopButtonHandler
      }
      if (globalEnv.button?.c) {
        globalEnv.button.c.onChanged = previousCHandler ?? noopButtonHandler
      }
    }
    const choose = (choice: 'retry' | 'offline') => {
      if (resolved) return
      resolved = true
      restoreButtons()
      resolve(choice)
    }

    trace(`[network] ${status.message}: ${status.reason}\n`)
    showWiFiRecoveryChoice({
      message: status.message,
      onRetry: () => choose('retry'),
      onOffline: () => choose('offline'),
    })
    if (globalEnv.button?.a) {
      globalEnv.button.a.onChanged = () => choose('retry')
    }
    if (globalEnv.button?.c) {
      globalEnv.button.c.onChanged = () => choose('offline')
    }
  })
}

// Only fixed identifiers and scalar measurements may cross the unauthenticated
// startup USB channel. The original exception is retained only by the normal
// private diagnostic path; never serialize its message or stack.
function emitStartupDiagnostic(phase: StartupPhase, checkpoint: string, error: unknown): void {
  const errorClass = startupErrorClass(error)
  trace(`[startup-diag] checkpoint=${checkpoint} phase=${phase} error=${errorClass}\n`)
  try {
    if (!Modules.has('archive-usb')) return
    const usb = Modules.importNow('archive-usb') as {
      writeDebugUSB(packet: string): boolean
      resetReason(): number
      heapStatus(): { internalFree?: number; internalLargest?: number; psramFree?: number }
    }
    let resetReason = 0
    let heap: { internalFree?: number; internalLargest?: number; psramFree?: number } = {}
    try { resetReason = usb.resetReason() } catch { /* Unknown; report zero. */ }
    try { heap = usb.heapStatus() } catch { /* Unknown; report zeros. */ }
    const record = makeStartupFailureRecord({ phase, checkpoint, errorClass, resetReason, heap })
    if (!usb.writeDebugUSB(JSON.stringify(record))) {
      trace('[startup-diag] usb=unavailable\n')
    }
  } catch {
    // The observer must never replace the original startup error or modify settings.
    trace('[startup-diag] usb=unavailable\n')
  }
}

// A small, fixed-schema status packet bypasses archive-debug's private trace
// ring. That ring is not drained until an authenticated Archive USB request;
// an early crash would otherwise appear to stop at main-entry.
function emitStartupProgress(phase: StartupPhase, checkpoint: string, state: 'begin' | 'done'): void {
  try {
    const record = makeStartupProgressRecord({ phase, checkpoint, state })
    if (!record || !Modules.has('archive-usb')) return
    const usb = Modules.importNow('archive-usb') as { writeDebugUSB(packet: string): boolean }
    usb.writeDebugUSB(JSON.stringify(record))
  } catch {
    // Best effort only: never prevent the official face or offline boot.
  }
}

async function main() {
  emitStartupProgress('initialization', 'debug-init', 'begin')
  try {
    if (Modules.has('archive-debug')) (Modules.importNow('archive-debug') as { installDebugLog: () => void }).installDebugLog()
  } catch { trace('[debug] log initialization unavailable\n') }
  emitStartupProgress('initialization', 'debug-init', 'done')
  emitStartupProgress('initialization', 'screen-init', 'begin')
  try {
    if (Modules.has('archive-screen')) (Modules.importNow('archive-screen') as { installScreenCapture: () => void }).installScreenCapture()
  } catch { trace('[screen] capture initialization unavailable\n') }
  emitStartupProgress('initialization', 'screen-init', 'done')
  trace('[main] start\n')
  let dockRuntime: StackchanDockRuntime | undefined
  let context: StackchanContext | undefined
  let phase: StartupPhase = 'initialization'
  let checkpoint = 'dock-start'
  try {
    dockRuntime = startStackchanDock(Modules, loadModConfig())
    if (dockRuntime) trace('[main] Stackchan Dock started\n')
    checkpoint = 'platform-input'
    installPlatformInputBridge()
    checkpoint = 'localization'
    initializeLocalization(loadPreferences(DOMAIN.ui).language)
    checkpoint = 'timezone'
    applyTimezone(loadPreferences(DOMAIN.time).timezone)

    checkpoint = 'behavior-resolve'
    trace('[main] loading app behaviors\n')
    const appBehaviors = loadAppBehaviors()
    // Launch behaviors run before startHostBootServices so the splash screen is
    // visible while network setup blocks.
    phase = 'launch'
    checkpoint = 'on-launch'
    const launch = await prepareAppLaunch(appBehaviors, () => {
      checkpoint = 'miniapp-prepare'
      return prepareExperimentalMiniApps()
    })
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
    checkpoint = 'network-start'
    const bootServices = startHostBootServices({
      wifi: {
        onStatusChanged: showWiFiConnectionStatus,
        promptRecoveryChoice: waitForBootWiFiRecoveryChoice,
      },
    })
    checkpoint = 'network-ready'
    const networkReady = await bootServices.connectivity.network.ready
    trace(`[main] network ready: ${networkReady.status}\n`)
    phase = 'context'
    checkpoint = 'preferences'
    const preferences = loadPreferenceConfig()
    const ownedDock = dockRuntime
    checkpoint = 'context-create'
    context = createStackchanContext(preferences, {
      connectivity: bootServices.connectivity,
      remoteConversationSession: ownedDock?.remoteConversationSession,
      closeHandlers: ownedDock ? [() => ownedDock.close()] : undefined,
    })
    phase = 'behavior'
    checkpoint = 'dock-context'
    ownedDock?.onContextCreated(context)
    checkpoint = 'miniapp-register'
    registerExperimentalMiniApps(experimentalMiniApps, context.ui.miniApps)
    trace('[main] app context created\n')
    checkpoint = 'context-behaviors'
    await runContextCreatedBehaviors(appBehaviors, context, {
      device: getHostDeviceEnvironment(),
      config: preferences,
    })
    checkpoint = 'archive-import'
    // A completed core boot is not proof that Archive features were loaded.
    // Record import and start separately so settings/mini-app regressions
    // remain visible on the safe, fixed-schema USB channel.
    emitStartupProgress(phase, checkpoint, 'begin')
    // Archive is optional: a broken module import must not replace the official
    // face with a fatal startup screen. Keep its error in fixed-schema USB logs.
    let archive: { startArchive: (context: StackchanContext) => void } | undefined
    try {
      archive = importOptionalArchive(Modules, (error: unknown) => {
        emitStartupDiagnostic(phase, 'archive-import', error)
        trace('[main] archive import failed; continuing core startup\n')
      }) as { startArchive: (context: StackchanContext) => void } | undefined
    } catch (error) {
      // The optional loader itself can fail before its internal import guard.
      // Never let an Archive dependency prevent the official face from booting.
      emitStartupDiagnostic(phase, 'archive-import', error)
      trace('[main] archive loader failed; continuing core startup\n')
    }
    if (archive) {
      emitStartupProgress(phase, 'archive-import', 'done')
      checkpoint = 'archive-start'
      emitStartupProgress(phase, checkpoint, 'begin')
      // Errors after import may leave partially initialized resources behind,
      // so they are deliberately handled by the existing fatal startup path.
      archive.startArchive(context)
      emitStartupProgress(phase, checkpoint, 'done')
    }
    checkpoint = 'finalize'
    emitStartupProgress(phase, 'finalize', 'begin')
    installModManagerShortcut()
    trace('[main] app behaviors ready\n')
    // A fixed-schema USB completion survives Archive's private trace ring.
    // boot-check may use it even when optional Archive was skipped.
    emitStartupProgress(phase, 'finalize', 'done')
  } catch (error) {
    emitStartupDiagnostic(phase, checkpoint, error)
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
        showStartupError({ phase, error, onRestart: () => System.restart?.() })
        installModManagerShortcut()
      } catch (displayError) {
        trace(`[main] startup error display failed ${startupErrorClass(displayError)}\n`)
      }
    }
    throw error
  }
}

void main().catch(() => undefined)
