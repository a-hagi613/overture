import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { JobHandlers } from "../platform/jobs/run-due.ts";
import type { AdjustableClock } from "../platform/ports/clock.ts";

import { bgJobs } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { runDueJobs } from "../platform/jobs/run-due.ts";
import { OTEL_ATTRIBUTE_ALLOWLIST } from "../platform/telemetry/otel.ts";

const offsetBody = z.object({ offsetMs: z.number().int() });

const enqueueBody = z.object({
  kind: z.string().min(1),
  payload: z.string(),
  runAt: z.number().int().nullable().optional(),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().optional(),
  dedupeKey: z.string().optional(),
});

const attributesBody = z.object({
  attributes: z.record(z.string(), z.string().or(z.number()).or(z.boolean()).or(z.null())),
});

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

  routes.post("/jobs/enqueue", zValidator("json", enqueueBody), (context) => {
    const { kind, payload, runAt, priority, maxAttempts, dedupeKey } = context.req.valid("json");

    const opts = {
      ...(runAt !== null && runAt !== undefined && { runAt }),
      ...(priority !== undefined && { priority }),
      ...(maxAttempts !== undefined && { maxAttempts }),
      ...(dedupeKey !== undefined && { dedupeKey }),
    };

    const id = enqueueJob(db, clock, kind, payload, opts);

    return context.json({ id });
  });

  routes.get("/jobs/:id", (context) => {
    const { id } = context.req.param();
    const job = db.select().from(bgJobs).where(eq(bgJobs.id, id)).get();

    if (job === undefined) {
      return context.json({ error: "not found" }, 404);
    }

    return context.json(job);
  });

  routes.post("/telemetry/redact", zValidator("json", attributesBody), (context) => {
    const { attributes } = context.req.valid("json");
    const redacted: Record<string, string | number | boolean | null> = {};

    for (const [key, value] of Object.entries(attributes)) {
      redacted[key] = OTEL_ATTRIBUTE_ALLOWLIST.has(key) ? value : "[redacted]";
    }

    return context.json({ redacted, allowlist: [...OTEL_ATTRIBUTE_ALLOWLIST] });
  });

  return routes;
}
