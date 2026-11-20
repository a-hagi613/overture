import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { JobHandlers } from "../platform/jobs/run-due.ts";
import type { AdjustableClock } from "../platform/ports/clock.ts";

import { bgJobs, companies, companyBoards, postings } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { runDueJobs } from "../platform/jobs/run-due.ts";
import { setSetting, setKillSwitch } from "../platform/settings/index.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { getTestSpans, resetTestSpans } from "../platform/telemetry/otel.ts";
import { releaseBlockingJobs } from "../testing/blocking-job.ts";
import { readCompaniesParquet } from "../catalog/companies-parquet.ts";
import { loadDiscoveredBoards } from "../catalog/discovered-boards.ts";

const offsetBody = z.object({ offsetMs: z.number().int() });

const enqueueBody = z.object({
  kind: z.string().min(1),
  payload: z.string(),
  runAt: z.number().int().nullable().optional(),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().optional(),
  dedupeKey: z.string().optional(),
});

const settingBody = z.object({ value: z.string().min(1) });

const killSwitchBody = z.object({
  enabled: z.boolean(),
  reason: z.string().default(""),
  setBy: z.enum(["auto", "owner"]).default("owner"),
});

const publishBody = z.object({
  topic: z.string().min(1),
  payload: z.record(z.string(), z.string().or(z.number()).or(z.boolean()).or(z.null())),
  userId: z.string().optional(),
});

const createCompanyBody = z.object({
  name: z.string().min(1),
  domain: z.string().min(1).nullish(),
});

const createBoardBody = z.object({
  companyId: z.string().min(1),
  ats: z.enum(["greenhouse", "lever", "ashby"]),
  boardToken: z.string().min(1),
  status: z.enum(["active", "empty", "gone", "disabled"]).default("active"),
  source: z.enum(["v1_seed", "discovered", "import"]).default("discovered"),
});

const discoveredBoardsBody = z.object({ path: z.string().min(1) });

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

  routes.post("/jobs/release", (context) => {
    releaseBlockingJobs();

    return context.json({ ok: true });
  });

  routes.put("/settings/:key", zValidator("json", settingBody), (context) => {
    const { key } = context.req.param();
    const { value } = context.req.valid("json");

    setSetting(db, clock, key, value, "owner");

    return context.json({ key, value });
  });

  routes.put("/kill-switches/:scope/:key", zValidator("json", killSwitchBody), (context) => {
    const { scope, key } = context.req.param();
    const { enabled, reason, setBy } = context.req.valid("json");

    const validScope = z.enum(["global", "ats", "employer", "provider"]).safeParse(scope);

    if (!validScope.success) {
      return context.json({ error: "invalid scope" }, 400);
    }

    setKillSwitch(db, clock, validScope.data, key, enabled, reason, setBy);

    return context.json({ scope, key, enabled, reason, setBy });
  });

  routes.post("/events/publish", zValidator("json", publishBody), (context) => {
    const { topic, payload, userId } = context.req.valid("json");

    publishEvent(db, clock, topic, JSON.stringify(payload), userId);

    return context.json({ ok: true });
  });

  routes.get("/telemetry/spans", (context) => {
    const spans = getTestSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
    }));

    return context.json({ spans });
  });

  routes.post("/telemetry/reset", (context) => {
    resetTestSpans();

    return context.json({ ok: true });
  });

  routes.post("/catalog/companies", zValidator("json", createCompanyBody), (context) => {
    const { name, domain } = context.req.valid("json");
    const id = crypto.randomUUID();

    db.insert(companies)
      .values({
        id,
        name,
        nameNorm: name.toLowerCase(),
        domain: domain ?? null,
        createdAt: clock.now(),
      })
      .run();

    return context.json({ id });
  });

  routes.post("/catalog/boards", zValidator("json", createBoardBody), (context) => {
    const { companyId, ats, boardToken, status, source } = context.req.valid("json");
    const id = crypto.randomUUID();

    db.insert(companyBoards)
      .values({
        id,
        companyId,
        ats,
        boardToken,
        status,
        source,
        notFoundPolls: 0,
        createdAt: clock.now(),
      })
      .onConflictDoNothing()
      .run();

    return context.json({ id });
  });

  routes.get("/catalog/boards", (context) => {
    const rows = db.select().from(companyBoards).all();

    return context.json({ boards: rows });
  });

  routes.get("/catalog/postings", (context) => {
    const rows = db.select().from(postings).all();

    return context.json({ postings: rows });
  });

  routes.post(
    "/catalog/discovered-boards",
    zValidator("json", discoveredBoardsBody),
    async (context) => {
      const { path } = context.req.valid("json");
      const bytes = readFileSync(path);
      const file = new ArrayBuffer(bytes.byteLength);

      new Uint8Array(file).set(bytes);

      const { rows } = await readCompaniesParquet(file);
      const report = loadDiscoveredBoards(db, clock, rows);

      return context.json(report);
    },
  );

  return routes;
}
