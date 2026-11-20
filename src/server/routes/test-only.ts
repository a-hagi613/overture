import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { JobHandlers } from "../platform/jobs/run-due.ts";
import type { AdjustableClock } from "../platform/ports/clock.ts";

import { runDueJobs } from "../platform/jobs/run-due.ts";

const offsetBody = z.object({ offsetMs: z.number().int() });

export function createTestRoutes(db: AppDatabase, clock: AdjustableClock, handlers: JobHandlers) {
  const routes = new Hono();

  routes.get("/clock", (context) => context.json({ now: clock.now(), offsetMs: clock.offset() }));

  routes.post("/clock/offset", zValidator("json", offsetBody), (context) => {
    const { offsetMs } = context.req.valid("json");

    clock.setOffset(offsetMs);

    return context.json({ now: clock.now(), offsetMs: clock.offset() });
  });

  routes.post("/jobs/run-due", async (context) => {
    const ran = await runDueJobs(db, clock, handlers);

    return context.json({ ran });
  });

  return routes;
}
