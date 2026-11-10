import { localize } from 'localization'
import type { NetworkReadyResult } from './boot-services.js'

export type BootWiFiRecoveryChoice = 'retry' | 'offline'

/**
 * Bound the recovery screen so offline startup does not require user input.
 * Always restore temporary input handlers before resolving.
 */
export function waitForBootWiFiRecoveryChoiceWithTimeout<T>(
  timer: { set(callback: () => void, milliseconds: number): T; clear(handle: T): void },
  showChoice: (select: (choice: BootWiFiRecoveryChoice) => void) => void,
  cleanup: () => void,
  timeoutMs = 15000,
  onTimeout?: () => void,
): Promise<BootWiFiRecoveryChoice> {
  return new Promise((resolve) => {
    let settled = false
    let handle: T | undefined
    const choose = (choice: BootWiFiRecoveryChoice) => {
      if (settled) return
      settled = true
      if (handle !== undefined) {
        try { timer.clear(handle) } catch { /* Do not block startup. */ }
      }
      try { cleanup() } catch { /* Best effort input restoration. */ }
      resolve(choice)
    }
    try {
      handle = timer.set(() => {
        try { onTimeout?.() } finally { choose('offline') }
      }, timeoutMs)
      showChoice(choose)
    } catch {
      choose('offline')
    }
  })
}

export type BootWiFiFailureKind = 'missing-credentials' | 'scan-exhausted' | 'connection-failed'
type OfflineNetworkReadyResult = Extract<NetworkReadyResult, { status: 'skipped' }>

export function shouldRetryBootWiFiAttempt(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts
}

export function classifyBootWiFiFailure(reason: string): BootWiFiFailureKind {
  const normalized = reason.toLowerCase()
  if (normalized.includes('missing wi-fi credentials') || normalized.includes('no wi-fi ssid') || normalized.includes('no wi-fi password')) return 'missing-credentials'
  if (normalized.includes('not found') || normalized.includes('scan exhausted')) {
    return 'scan-exhausted'
  }
  return 'connection-failed'
}

export function bootWiFiFailureMessage(reason: string): string {
  if (classifyBootWiFiFailure(reason) === 'missing-credentials') return localize('boot.wifiMissing')
  if (classifyBootWiFiFailure(reason) === 'scan-exhausted') {
    return localize('boot.wifiNotFound')
  }
  return localize('boot.wifiFailed')
}

export function networkReadyResultForRecoveryChoice(
  choice: BootWiFiRecoveryChoice,
  reason: string,
): OfflineNetworkReadyResult | undefined {
  if (choice === 'retry') return undefined
  requestOfflineBoot()
  return {
    status: 'skipped',
    reason: `offline start selected: ${classifyBootWiFiFailure(reason)}`,
  }
}

// A per-boot decision, never persisted into Wi-Fi credentials.
let offlineBootRequested = false
export function requestOfflineBoot(): void { offlineBootRequested = true }
export function isOfflineBootRequested(): boolean { return offlineBootRequested }
export function resumeBootWiFi(): void { offlineBootRequested = false }
