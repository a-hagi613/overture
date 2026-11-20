import { z } from "zod";

import { openDatabase } from "../src/server/platform/db/client.ts";

const healthSchema = z.object({
  status: z.string(),
  database: z.string(),
  backups: z.union([
    z.object({ replication: z.literal("ok"), lagSeconds: z.number(), replicaTxid: z.string() }),
    z.object({ replication: z.enum(["unconfigured", "unavailable"]) }),
  ]),
});

const [restoredDatabasePath, healthUrl] = process.argv.slice(2);

async function checkHealthEndpoint(
  endpoint: string,
  checked: { integrity: string; migrations: number; rowCount: Record<string, number> },
) {
  const response = await fetch(endpoint);
  const body = healthSchema.parse(await response.json());

  const report = {
    integrity: checked.integrity,
    migrations: checked.migrations,
    rowCount: checked.rowCount,
    health: body.status,
    database: body.database,
    replication: body.backups.replication,
    replicaTxid: body.backups.replication === "ok" ? body.backups.replicaTxid : null,
  };

  const failed =
    !response.ok ||
    body.status !== "ok" ||
    body.database !== "ok" ||
    body.backups.replication !== "ok" ||
    checked.integrity !== "ok" ||
    checked.migrations === 0;

  return [report, failed] as const;
}

const restored = z.string().min(1).parse(restoredDatabasePath);
const health = z.url().optional().parse(healthUrl);

const { sqlite } = openDatabase(restored);

const integrity = z
  .object({ integrity_check: z.string() })
  .parse(sqlite.query("pragma integrity_check").get()).integrity_check;

const migrations = z
  .object({ n: z.number() })
  .parse(sqlite.query("select count(*) as n from __drizzle_migrations").get()).n;

const tableNames = z
  .array(z.object({ name: z.string() }))
  .parse(
    sqlite
      .query(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle_%'",
      )
      .all(),
  )
  .map((table) => table.name);

const rowCount = Object.fromEntries(
  tableNames.map((name) => [
    name,
    z.object({ n: z.number() }).parse(sqlite.query(`select count(*) as n from "${name}"`).get()).n,
  ]),
);

sqlite.close();

const checked = { integrity, migrations, rowCount };

const [report, failed] =
  health === undefined
    ? [checked, integrity !== "ok" || migrations === 0]
    : await checkHealthEndpoint(health, checked);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (failed) {
  throw new Error("restored database checks failed");
}

process.stdout.write("restored database checks passed\n");
