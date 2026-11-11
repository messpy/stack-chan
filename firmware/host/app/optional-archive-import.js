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
    // A broken optional-Archive lookup can raise ReferenceError before importNow.
    // Preserve core boot and report it; keep unrelated registry failures visible.
    if (!(error instanceof ReferenceError)) throw error;
    reportArchiveImportError(onImportError, error);
    return undefined;
  }
  if (!available) return undefined;
  try {
    return modules.importNow('lan-archive');
  } catch (error) {
    reportArchiveImportError(onImportError, error);
    return undefined;
  }
}
