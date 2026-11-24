import type { CatalogDatabase } from "../platform/db/client.ts";

/**
 * A cheap fingerprint of the catalog's current contents. `PRAGMA data_version` moves when another
 * connection — the sweep worker — commits, and `total_changes()` moves when this connection writes, so a
 * count cached under this revision can never outlive the rows it counted.
 * @param db The catalog database.
 * @returns The revision string, or null when SQLite does not answer.
 */
export function catalogRevision(db: CatalogDatabase) {
  const client = db.$client;

  const dataVersion = client
    .query<{ data_version: number }, []>("PRAGMA data_version")
    .get()?.data_version;

  const totalChanges = client
    .query<{ total: number }, []>("SELECT total_changes() AS total")
    .get()?.total;

  if (dataVersion === undefined || totalChanges === undefined) {
    return null;
  }

  return `${String(dataVersion)}:${String(totalChanges)}`;
}
