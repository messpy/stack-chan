import { localize } from 'localization'
import type { NetworkReadyResult } from './boot-services.js'

export type BootWiFiRecoveryChoice = 'retry' | 'offline'

export const DEFAULT_BOOT_WIFI_RECOVERY_TIMEOUT_MS = 10000

export type BootWiFiRecoveryTimer = {
  set(callback: () => void, interval: number): unknown
  clear(handle: unknown): void
}

/**
 * Give the user a bounded chance to retry. A disconnected touchscreen or
 * unattended boot must not keep the face hidden indefinitely.
 * The caller restores its temporary hardware button handlers in cleanup.
 */
export function waitForBootWiFiRecoveryChoiceWithTimeout(
  timer: BootWiFiRecoveryTimer,
  showChoice: (select: (choice: BootWiFiRecoveryChoice) => void) => void,
  cleanup: () => void,
  timeoutMs = DEFAULT_BOOT_WIFI_RECOVERY_TIMEOUT_MS,
  onTimeout?: () => void,
): Promise<BootWiFiRecoveryChoice> {
  return new Promise((resolve) => {
    let settled = false
    let handle: unknown
    const select = (choice: BootWiFiRecoveryChoice) => {
      if (settled) return
      settled = true
      if (handle !== undefined) {
        try {
          timer.clear(handle)
        } catch {
          // Continue booting even if releasing the timer fails.
        }
      }
      try {
        cleanup()
      } catch {
        // Stale button callbacks must not prevent boot.
      }
      resolve(choice)
    }

    try {
      handle = timer.set(() => {
        try {
          onTimeout?.()
        } finally {
          select('offline')
        }
      }, timeoutMs)
      showChoice(select)
    } catch {
      // No timer or recovery UI available: prefer a usable local face.
      select('offline')
    }
  })
}

export type BootWiFiFailureKind = 'scan-exhausted' | 'connection-failed'
type OfflineNetworkReadyResult = Extract<NetworkReadyResult, { status: 'skipped' }>

export function shouldRetryBootWiFiAttempt(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts
}

export function classifyBootWiFiFailure(reason: string): BootWiFiFailureKind {
  const normalized = reason.toLowerCase()
  if (normalized.includes('not found') || normalized.includes('scan exhausted')) {
    return 'scan-exhausted'
  }
  return 'connection-failed'
}

export function bootWiFiFailureMessage(reason: string): string {
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
  return {
    status: 'skipped',
    reason: `offline start selected: ${reason}`,
  }
}
