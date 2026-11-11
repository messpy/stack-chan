// Archive is an optional extension of the host runtime.
// A failed module evaluation must not prevent the official face from booting.
// This catches import failures only: errors during startArchive() must remain
// visible to the normal startup error handler.
export function importOptionalArchive(modules, onImportError) {
  if (!modules.has('lan-archive')) return undefined;
  try {
    return modules.importNow('lan-archive');
  } catch (error) {
    try {
      onImportError?.(error);
    } catch {
      // Reporting is best effort and must not replace or rethrow the import error.
    }
    return undefined;
  }
}
