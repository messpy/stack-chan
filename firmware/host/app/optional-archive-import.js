// Archive is an optional extension of the host runtime.
// A failed module evaluation must not prevent the official face from booting.
// This catches import failures only: errors during startArchive() must remain
// visible to the normal startup error handler.
function reportArchiveImportError(onImportError, error) {
  try {
    onImportError?.(error);
  } catch {
    // Diagnostics must never replace the original optional-Archive failure.
  }
}

export function importOptionalArchive(modules, onImportError) {
  let available;
  try {
    available = modules.has('lan-archive');
  } catch (error) {
    // A registry lookup may fail even when the compiled module is available.
    // A bounded direct import gives Archive/settings one chance to start.
    // Non-ReferenceError registry failures still go to the fatal handler.
    if (!(error instanceof ReferenceError)) throw error;
    available = true;
  }
  if (!available) return undefined;
  try {
    return modules.importNow('lan-archive');
  } catch (error) {
    reportArchiveImportError(onImportError, error);
    return undefined;
  }
}
