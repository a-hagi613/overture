import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { AdjustableClock } from "../platform/ports/clock.ts";

import { sql } from "drizzle-orm";

import { readBackupStatus } from "../platform/ports/backup.ts";

export function createHealthRoutes(db: AppDatabase, clock: AdjustableClock) {
  const routes = new Hono();

  routes.get("/health", async (context) => {
    db.run(sql`select 1`);

    const backups = await readBackupStatus(clock.now());

    if (backups.replication === "unconfigured") {
      return context.json({ status: "ok", database: "ok" });
    }

    return context.json({ status: "ok", database: "ok", backups });
  });

  return routes;
}
