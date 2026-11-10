/**
 * IMU is optional hardware: failure to initialize it must not block the
 * local UI and unrelated device services. No persistent settings are changed.
 */
export function createOptionalIMU<T>(
  create: () => T,
  onUnavailable?: (error: unknown) => void,
): T | undefined {
  try {
    return create()
  } catch (error) {
    try {
      onUnavailable?.(error)
    } catch {
      // Diagnostics must never turn a recoverable sensor error into a fatal boot.
    }
    return undefined
  }
}
