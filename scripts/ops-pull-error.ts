import { desc, isNotNull } from "drizzle-orm";
import { parseArgs } from "node:util";

import { redactPullError } from "../src/server/jobs/pull-error.ts";
import { openReadOnlyDatabase } from "../src/server/platform/db/client.ts";
import { jobPullRuns } from "../src/server/platform/db/schema.ts";
import { getSetting } from "../src/server/platform/settings/index.ts";

const DIAGNOSTIC_ERROR_MAX_CHARS = 2000;
const LAST_RUNS = 10;

const args = parseArgs({ options: { db: { type: "string" } }, strict: true });

const databasePath =
  args.values.db ?? Bun.env.DATABASE_PATH ?? Bun.env.DATABASE_URL ?? "/data/app.sqlite";

const { db, sqlite } = openReadOnlyDatabase(databasePath);

try {
  const runs = db
    .select({
      error: jobPullRuns.error,
      groupKey: jobPullRuns.groupKey,
      mode: jobPullRuns.mode,
      startedAt: jobPullRuns.startedAt,
    })
    .from(jobPullRuns)
    .where(isNotNull(jobPullRuns.error))
    .orderBy(desc(jobPullRuns.startedAt))
    .limit(LAST_RUNS)
    .all();

  process.stdout.write(
    `${JSON.stringify(
      {
        "jobs.pull_failures": getSetting(db, "jobs.pull_failures"),
        "jobs.pull_last_error": redactPullError(
          getSetting(db, "jobs.pull_last_error") ?? "",
          DIAGNOSTIC_ERROR_MAX_CHARS,
        ),
        database_path: databasePath,
        runs: runs.map((run) => ({
          error: redactPullError(run.error ?? "", DIAGNOSTIC_ERROR_MAX_CHARS),
          group_key: run.groupKey,
          mode: run.mode,
          started_at: new Date(run.startedAt).toISOString(),
        })),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  sqlite.close();
}
