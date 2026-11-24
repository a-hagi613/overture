const warned = new Set<string>();

/**
 * SQLite reports a write against a read-only connection as `SQLITE_READONLY`; the R2 hot-swapped catalog is opened
 * read-only on purpose (issue #576), so a runtime cache write is best-effort rather than fatal.
 * @param error the caught value, already narrowed to an Error or null
 * @returns whether the write failed only because the catalog cannot be written
 */
export function isReadOnlyCatalogError(error: Error | null) {
  return (
    error !== null && /readonly|read-only|SQLITE_READONLY/iu.test(`${error.name} ${error.message}`)
  );
}

/**
 * Run a catalog write, ignoring a read-only refusal and warning once per call site.
 * @param scope a short label for the log line
 * @param run the write
 * @returns whether the write was applied
 */
export function bestEffortCatalogWrite(scope: string, run: () => void) {
  try {
    run();

    return true;
  } catch (error) {
    if (!isReadOnlyCatalogError(error instanceof Error ? error : null)) {
      throw error;
    }

    if (!warned.has(scope)) {
      warned.add(scope);
      process.stderr.write(
        `overture catalog.read_only: skipped ${scope}: the catalog is a read-only R2 hot-swap\n`,
      );
    }

    return false;
  }
}

/**
 * Clears the once-per-scope warning set, so one test does not silence another.
 * @returns nothing
 */
export function resetReadOnlyCatalogWarnings() {
  warned.clear();
}
