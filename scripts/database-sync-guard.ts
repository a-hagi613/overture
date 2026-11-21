export interface DatabaseSyncSource {
  path: string;
  source: string;
}

export interface DatabaseSyncOptOut {
  path: string;
  reason: string;
}

export const DATABASE_SYNC_OPT_OUTS: readonly DatabaseSyncOptOut[] = [];

const DATABASE_SYNC_HANDLE = /new\s+DatabaseSync\s*\(/u;
const BUSY_TIMEOUT = /PRAGMA\s+busy_timeout\b/iu;

export function findUnguardedDatabaseSyncHandles(
  files: readonly DatabaseSyncSource[],
  optOuts: readonly DatabaseSyncOptOut[] = DATABASE_SYNC_OPT_OUTS,
) {
  return files.flatMap(({ path, source }) => {
    if (!DATABASE_SYNC_HANDLE.test(source) || BUSY_TIMEOUT.test(source)) {
      return [];
    }

    if (optOuts.some((optOut) => optOut.path === path)) {
      return [];
    }

    return [
      `${path} opens a node:sqlite DatabaseSync handle without a busy timeout. ` +
        "Add `PRAGMA busy_timeout = <ms>` on the handle right after opening it: node:sqlite starts at 0, " +
        "so a concurrent writer fails at once with SQLITE_BUSY instead of waiting. A handle that must stay at 0 " +
        "needs an entry with its reason in DATABASE_SYNC_OPT_OUTS (scripts/database-sync-guard.ts).",
    ];
  });
}
