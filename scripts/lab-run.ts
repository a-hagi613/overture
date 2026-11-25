import { gte } from "drizzle-orm";

import { databasePath, env } from "../src/server/config/env.ts";
import { LAB_JOB_KIND, labRunPayloadSchema } from "../src/server/lab/job.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { labRuns } from "../src/server/platform/db/schema.ts";
import { enqueueJob } from "../src/server/platform/jobs/queue.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";

const WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 10_000;

const clock = createClock();

const [pages = "form", sessions = "3", providers = "browser_use"] = Bun.argv.slice(2);

const payload = labRunPayloadSchema.parse({
  pages: pages.split(",").map((page) => page.trim()),
  providers: providers.split(",").map((name) => name.trim()),
  sessionsPerPage: Number(sessions),
});

const expected = payload.pages.length * payload.providers.length * payload.sessionsPerPage;

const { db } = openDatabase(databasePath, {
  checkpointOwner: env.LITESTREAM_OWNS_CHECKPOINTS ? "litestream" : "sqlite",
});

const queuedAt = clock.now();

const job = enqueueJob(db, clock, LAB_JOB_KIND, JSON.stringify(payload), {
  dedupeKey: "lab.run.queued",
  maxAttempts: 1,
});

process.stdout.write(
  `queued ${LAB_JOB_KIND} ${JSON.stringify({ expected, job, payload })}; waiting up to ${String(WAIT_MS / 60_000)} min\n`,
);

const rowsSinceQueued = () =>
  db.select().from(labRuns).where(gte(labRuns.createdAt, queuedAt)).all();

const deadline = clock.now() + WAIT_MS;

const rows = await new Promise<(typeof labRuns.$inferSelect)[]>((resolve) => {
  const timer = setInterval(() => {
    check();
  }, POLL_MS);

  function check() {
    const found = rowsSinceQueued();

    if (found.length >= expected || clock.now() >= deadline) {
      clearInterval(timer);
      resolve(found);
    }
  }

  check();
});

for (const row of rows) {
  process.stdout.write(
    `${JSON.stringify({
      costUsd: row.costMicros === null ? null : row.costMicros / 1_000_000,
      durationS: Math.round(row.durationMs / 1000),
      errorCode: row.errorCode,
      outcome: row.outcome,
      page: row.page,
      provider: row.provider,
      sessionId: row.sessionId,
    })}\n`,
  );
}

const completed = rows.filter((row) => row.outcome === "completed").length;

process.stdout.write(
  `lab run: ${String(rows.length)}/${String(expected)} sessions recorded, ${String(completed)} completed\n`,
);

if (completed < expected) {
  process.exitCode = 1;
}
