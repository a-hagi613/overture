import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";

import { sql } from "drizzle-orm";

export function createHealthRoutes(db: AppDatabase) {
  const routes = new Hono();

  routes.get("/health", (context) => {
    db.run(sql`select 1`);

    return context.json({ status: "ok", database: "ok" });
  });

  return routes;
}
