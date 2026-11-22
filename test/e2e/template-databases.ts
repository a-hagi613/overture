import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TEMPLATE_DATABASE = "test/e2e/.tmp/template.db";
export const TEMPLATE_CATALOG_DATABASE = "test/e2e/.tmp/template-catalog.db";

/**
 * The catalog file the server derives beside an application database (ADR 0036), for an e2e test that reads or seeds
 * the catalog directly.
 * @param databasePath The application database path.
 * @returns The sibling `catalog.sqlite` path.
 */
export function catalogDatabasePathFor(databasePath: string) {
  return databasePath === ":memory:" ? ":memory:" : join(dirname(databasePath), "catalog.sqlite");
}

/**
 * Copies the migrated application template and its catalog template into a scratch directory (ADR 0036). The server
 * derives `catalog.sqlite` beside `DATABASE_URL`, so the catalog copy must land on exactly that path.
 * @param databasePath The scratch application database path.
 */
export function copyTemplateDatabases(databasePath: string) {
  copyFileSync(join(process.cwd(), TEMPLATE_DATABASE), databasePath);
  copyFileSync(
    join(process.cwd(), TEMPLATE_CATALOG_DATABASE),
    catalogDatabasePathFor(databasePath),
  );
}
