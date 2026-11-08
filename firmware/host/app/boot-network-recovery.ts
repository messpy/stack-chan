import { localize } from 'localization'
import type { NetworkReadyResult } from './boot-services.js'

export type BootWiFiRecoveryChoice = 'retry' | 'offline'

/**
 * A recovery prompt cannot block unattended boots indefinitely.
 * Timers are armed before the prompt is displayed, and temporary hardware
 * button handlers are restored before the choice is resolved.
 */
export function waitForBootWiFiRecoveryChoiceWithTimeout<T>(
  timer: { set(callback: () => void, interval: number): T; clear(handle: T): void },
  showChoice: (select: (choice: BootWiFiRecoveryChoice) => void) => void,
  cleanup: () => void,
  timeoutMs = 15000,
  onTimeout?: () => void,
): Promise<BootWiFiRecoveryChoice> {
  return new Promise((resolve) => {
    let settled = false
    let handle: T | undefined
    const select = (choice: BootWiFiRecoveryChoice) => {
      if (settled) return
      settled = true
      if (handle !== undefined) {
        try {
          timer.clear(handle)
        } catch {
          // A failed timer cancellation must not hold the splash screen.
        }
      }
      try {
        cleanup()
      } catch {
        // Input handlers are best-effort cleanup.
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
      // A broken recovery UI/timer must not prevent local operation.
      select('offline')
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
  return {
    status: 'skipped',
    reason: `offline start selected: ${reason}`,
  }
}
