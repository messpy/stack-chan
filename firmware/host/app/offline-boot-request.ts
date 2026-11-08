// A one-shot in-memory flag: never persist "offline" by erasing credentials.
let requested = false

export function requestOfflineBoot(): void {
  requested = true
}

export function consumeOfflineBootRequest(): boolean {
  const wasRequested = requested
  requested = false
  return wasRequested
}
