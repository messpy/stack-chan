import {
  type BootWiFiRecoveryChoice,
  isOfflineBootRequested,
  bootWiFiFailureMessage,
  classifyBootWiFiFailure,
  networkReadyResultForRecoveryChoice,
  shouldRetryBootWiFiAttempt,
} from 'boot-network-recovery'
import type { NetworkReadyResult } from 'capabilities'
import { createLocalPeerCapability } from 'local-peer-capability'
import type { LocalPeerCapability } from 'local-peer-types'
import { localize } from 'localization'
import config from 'mc/config'
import { wait } from 'stackchan-util'
import Timer from 'timer'
import { connectStoredWiFi, stopStoredWiFiConnection } from 'stored-wifi'

export type { NetworkReadyResult } from 'capabilities'

export type HostBootServices = {
  connectivity: {
    network: {
      ready: Promise<NetworkReadyResult>
    }
    localPeer?: LocalPeerCapability
  }
}

export type BootWiFiStatus = {
  attempt: number
  maxAttempts: number
  message: string
}

export type HostBootServicesOptions = {
  wifi?: {
    maxAttempts?: number
    attemptTimeoutMs?: number
    retryDelayMs?: number
    onStatusChanged?: (status: BootWiFiStatus) => void
    promptRecoveryChoice?: (status: BootWiFiStatus & { reason: string }) => Promise<BootWiFiRecoveryChoice>
  }
}

type BootWiFiConfig = {
  ssid?: unknown
  password?: unknown
}

type BootConfig = {
  wifi?: BootWiFiConfig
}

const NOT_STARTED: NetworkReadyResult = {
  status: 'skipped',
  reason: 'host boot services not started',
}
const DEFAULT_BOOT_WIFI_MAX_ATTEMPTS = 3
const DEFAULT_BOOT_WIFI_RETRY_DELAY_MS = 500
const DEFAULT_BOOT_WIFI_ATTEMPT_TIMEOUT_MS = 20000

let bootServices: HostBootServices = {
  connectivity: {
    network: {
      ready: Promise.resolve(NOT_STARTED),
    },
  },
}

export function startHostBootServices(options: HostBootServicesOptions = {}): HostBootServices {
  const networkReady = startStoredWiFi(options.wifi)
  const localPeer = createLocalPeerCapability()
  bootServices = {
    connectivity: {
      network: {
        ready: networkReady,
      },
      localPeer,
    },
  }
  return bootServices
}

export function getHostBootServices(): HostBootServices {
  return bootServices
}

async function startStoredWiFi(
  options: NonNullable<HostBootServicesOptions['wifi']> = {},
): Promise<NetworkReadyResult> {
  if (isOfflineBootRequested()) {
    stopStoredWiFiConnection()
    return { status: 'skipped', reason: 'offline boot selected; credentials preserved' }
  }
  if ((config as { archiveUSBOnly?: boolean }).archiveUSBOnly) return { status: 'skipped', reason: 'USB archive mode' }
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOT_WIFI_MAX_ATTEMPTS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_BOOT_WIFI_RETRY_DELAY_MS
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_BOOT_WIFI_ATTEMPT_TIMEOUT_MS
  for (;;) {
    let lastReason = 'connection failed'
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      options.onStatusChanged?.({
        attempt,
        maxAttempts,
        message: localize('splash.connecting', { attempt, maxAttempts }),
      })
      const result = await connectStoredWiFiOnce(attemptTimeoutMs)
      if (result.status === 'connected') return result
      if (result.status === 'skipped' && !options.promptRecoveryChoice) return result
      lastReason = result.reason
      trace(`[network] boot Wi-Fi attempt ${attempt}/${maxAttempts}: ${classifyBootWiFiFailure(lastReason)}\n`)
      if (result.status === 'skipped') break
      if (shouldRetryBootWiFiAttempt(attempt, maxAttempts)) {
        await wait(retryDelayMs)
      }
    }

    const message = bootWiFiFailureMessage(lastReason)
    if (!options.promptRecoveryChoice) {
      return { status: 'failed', reason: lastReason }
    }
    const choice = await options.promptRecoveryChoice({
      attempt: maxAttempts,
      maxAttempts,
      message,
      reason: lastReason,
    })
    const result = networkReadyResultForRecoveryChoice(choice, lastReason)
    if (result) {
      trace(`[network] offline boot selected: ${classifyBootWiFiFailure(lastReason)}\n`)
      return result
    }
    trace('[network] retrying Wi-Fi by user request\n')
  }
}

function connectStoredWiFiOnce(attemptTimeoutMs: number): Promise<NetworkReadyResult> {
  return new Promise((resolve) => {
    let settled = false
    let attemptTimer: ReturnType<typeof Timer.set> | undefined
    const finish = (result: NetworkReadyResult) => {
      if (settled) return
      settled = true
      if (attemptTimer !== undefined) Timer.clear(attemptTimer)
      if (result.status !== 'connected') {
        stopStoredWiFiConnection()
      }
      resolve(result)
    }

    try {
      stopStoredWiFiConnection()
      // Includes the scan: a missing callback must not hold the boot splash.
      attemptTimer = Timer.set(() => {
        trace('[network] boot Wi-Fi attempt timeout (scan or connect)\n')
        finish({ status: 'failed', reason: 'boot Wi-Fi attempt timed out' })
      }, attemptTimeoutMs)
      const started = connectStoredWiFi({
        ...getBootWiFiCredentials(),
        scanBeforeConnect: true,
        onConnected: () => finish({ status: 'connected' }),
        onError: (reason) => {
          const message = reason ?? 'connection failed'
          trace(`[network] connection failed: ${classifyBootWiFiFailure(message)}\n`)
          finish({ status: 'failed', reason: message })
        },
      })
      if (!started) {
        finish({ status: 'skipped', reason: 'missing Wi-Fi credentials' })
      }
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
      trace(`[network] connection failed: ${classifyBootWiFiFailure(message)}\n`)
      finish({ status: 'failed', reason: message })
    }
  })
}

function getBootWiFiCredentials(): { ssid?: string; password?: string } {
  const bootConfig = config as BootConfig
  const wifi = bootConfig.wifi ?? {}
  const ssid = wifi.ssid
  const password = wifi.password
  return {
    ssid: typeof ssid === 'string' ? ssid : undefined,
    password: typeof password === 'string' ? password : undefined,
  }
}
