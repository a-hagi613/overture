import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { BackupMonitor } from "../platform/ports/backup.ts";

import { sql } from "drizzle-orm";

export function createHealthRoutes(db: AppDatabase, backups: BackupMonitor) {
  const routes = new Hono();

  routes.get("/health", (context) => {
    db.run(sql`select 1`);

    const status = backups.status();

    if (status.replication === "unconfigured") {
      return context.json({ status: "ok", database: "ok" });
    }

    return context.json({ status: "ok", database: "ok", backups: status });
  });

  return routes;
}
