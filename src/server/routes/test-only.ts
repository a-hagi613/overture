import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { JobHandlers } from "../platform/jobs/run-due.ts";
import type { AdjustableClock } from "../platform/ports/clock.ts";

import {
  accounts,
  bgJobs,
  companies,
  companyBoards,
  ledger,
  postingTags,
  postings,
  sessions,
  tagImports,
  users,
} from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { runDueJobs } from "../platform/jobs/run-due.ts";
import { setSetting, setKillSwitch } from "../platform/settings/index.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { clearSinkMail, listSinkMail } from "../platform/mail/sink.ts";
import { getTestSpans, resetTestSpans } from "../platform/telemetry/otel.ts";
import { releaseBlockingJobs } from "../testing/blocking-job.ts";
import { setTurnstileScenario, turnstileScenarioBody } from "../testing/turnstile-scenario.ts";
import { readCompaniesParquet } from "../catalog/companies-parquet.ts";
import { contentHash } from "../catalog/content-hash.ts";
import { loadDiscoveredBoards } from "../catalog/discovered-boards.ts";
import { sweepBatchPerAts } from "../catalog/discovery.ts";
import { dedupeKeyFor } from "../catalog/dedupe-key.ts";
import { normalizeApplyUrl, normalizeTitle } from "../catalog/normalize.ts";
import { DEFAULT_IMPORT_SOURCE, importTags } from "../catalog/tag-import.ts";
import { readLlmUsage, recordLlmUsage } from "../platform/llm/usage.ts";
import {
  applicationsLeft,
  commitForApplication,
  grantApplications,
  reserveForApplication,
} from "../billing/ledger.ts";

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

const tagImportBody = z.object({
  content: z.string().min(1),
  source: z.string().min(1).default(DEFAULT_IMPORT_SOURCE),
});

const llmUsageQuery = z.object({
  purpose: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const userNameBody = z.object({ email: z.email(), name: z.string().min(1) });

const lowercased = (value: string) => value.trim().toLowerCase();
const roleBody = z.object({ userId: z.string().min(1), role: z.enum(["user", "owner"]) });

const postingTagBody = z.object({
  dimension: z.enum(["role", "subrole", "seniority"]),
  value: z.string().min(1),
});

const sampleLedgerBody = z.object({ email: z.email() });

const tamperLedgerBody = z.object({
  action: z.enum(["delete", "delete-owner", "update"]),
});

const SAMPLE_GRANT_QUANTITY = 70;

const createPostingBody = z.object({
  boardId: z.string().min(1),
  companyId: z.string().min(1),
  ats: z.enum(["greenhouse", "lever", "ashby"]),
  atsJobId: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1),
  sourceUpdatedAt: z.number().int().nullish(),
  descriptionText: z.string().nullish(),
  workplace: z.enum(["remote", "hybrid", "onsite", "unknown"]).default("unknown"),
  employmentType: z
    .enum(["full_time", "part_time", "contract", "internship", "temporary", "unknown"])
    .default("unknown"),
  language: z.string().min(2).max(5).nullish(),
  locationRaw: z.string().nullish(),
  countryCode: z.string().length(2).nullish(),
  region: z.string().nullish(),
  city: z.string().nullish(),
  salaryMinMinor: z.number().int().nonnegative().nullish(),
  salaryCurrency: z.string().length(3).nullish(),
  tags: z.array(postingTagBody).max(20).default([]),
});

const bulkPostingsBody = z.object({
  postings: z.array(createPostingBody).min(1).max(2000),
});

const recordLlmUsageBody = z.object({
  purpose: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costMicros: z.number().int().min(0),
});

type PostingWriter = AppDatabase | Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

function seedPosting(writer: PostingWriter, row: z.infer<typeof createPostingBody>, now: number) {
  const id = crypto.randomUUID();
  const titleNorm = normalizeTitle(row.title);
  const descriptionText = row.descriptionText ?? null;

  writer
    .insert(postings)
    .values({
      id,
      boardId: row.boardId,
      companyId: row.companyId,
      ats: row.ats,
      atsJobId: row.atsJobId,
      url: row.url,
      applyUrl: null,
      applyUrlNorm: normalizeApplyUrl(row.url),
      title: row.title,
      titleNorm,
      locationRaw: row.locationRaw ?? null,
      countryCode: row.countryCode ?? null,
      region: row.region ?? null,
      city: row.city ?? null,
      language: row.language ?? null,
      workplace: row.workplace,
      employmentType: row.employmentType,
      salaryMinMinor: row.salaryMinMinor ?? null,
      salaryCurrency: row.salaryCurrency ?? null,
      dedupeKey: dedupeKeyFor({
        companyId: row.companyId,
        titleNorm,
        countryCode: row.countryCode ?? null,
        city: row.city ?? null,
      }),
      firstSeenAt: now,
      lastSeenAt: now,
      sourceUpdatedAt: row.sourceUpdatedAt ?? null,
      descriptionGz: descriptionText === null ? null : Buffer.from(Bun.gzipSync(descriptionText)),
      descriptionHash: descriptionText === null ? null : contentHash(descriptionText),
      tagSource: null,
      closedAt: null,
    })
    .run();

  for (const tag of row.tags) {
    writer
      .insert(postingTags)
      .values({ postingId: id, dimension: tag.dimension, value: tag.value, source: "import" })
      .onConflictDoNothing()
      .run();
  }

  return id;
}

export function createTestRoutes(
  db: AppDatabase,
  clock: AdjustableClock,
  handlers: JobHandlers,
  singletonJobKinds: readonly string[],
) {
  const routes = new Hono();

  routes.get("/clock", (context) => context.json({ now: clock.now(), offsetMs: clock.offset() }));

  routes.post("/clock/offset", zValidator("json", offsetBody), (context) => {
    const { offsetMs } = context.req.valid("json");

    clock.setOffset(offsetMs);

    return context.json({ now: clock.now(), offsetMs: clock.offset() });
  });

  routes.post("/turnstile", zValidator("json", turnstileScenarioBody), (context) => {
    setTurnstileScenario(context.req.valid("json"));

    return context.json({ ok: true });
  });

  routes.post("/jobs/run-due", async (context) => {
    const ran = await runDueJobs(db, clock, handlers, singletonJobKinds);

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

    const job = enqueueJob(db, clock, kind, payload, opts);

    return context.json({ id: job.id });
  });

  routes.get("/jobs", (context) => {
    const rows = db.select().from(bgJobs).all();

    return context.json({ jobs: rows });
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

  routes.get("/catalog/sweep-batches", (context) =>
    context.json({ batches: sweepBatchPerAts(db) }),
  );

  routes.get("/catalog/postings", (context) => {
    const rows = db.select().from(postings).all();

    return context.json({ postings: rows });
  });

  routes.post("/catalog/postings", zValidator("json", createPostingBody), (context) => {
    const id = seedPosting(db, context.req.valid("json"), clock.now());

    return context.json({ id });
  });

  routes.post("/catalog/postings/bulk", zValidator("json", bulkPostingsBody), (context) => {
    const { postings: rows } = context.req.valid("json");
    const now = clock.now();

    db.transaction((tx) => {
      for (const row of rows) {
        seedPosting(tx, row, now);
      }
    });

    return context.json({ created: rows.length });
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

  routes.get("/catalog/posting-tags", (context) => {
    const rows = db.select().from(postingTags).all();

    return context.json({ postingTags: rows });
  });

  routes.post("/tag-imports", zValidator("json", tagImportBody), (context) => {
    const { content, source } = context.req.valid("json");

    const report = importTags(db, clock, { content, source, uploadedBy: "owner" });

    return context.json(report);
  });

  routes.get("/tag-imports", (context) => {
    const rows = db.select().from(tagImports).all();

    return context.json({ tagImports: rows });
  });

  routes.get("/llm/usage", zValidator("query", llmUsageQuery), (context) => {
    const { purpose, limit } = context.req.valid("query");

    const summary = readLlmUsage(db, {
      purpose: purpose ?? null,
      sinceMs: null,
      limit,
    });

    return context.json(summary);
  });

  routes.post("/llm/usage", zValidator("json", recordLlmUsageBody), (context) => {
    const { purpose, model, inputTokens, cachedTokens, outputTokens, costMicros } =
      context.req.valid("json");

    recordLlmUsage(db, clock, {
      userId: null,
      purpose,
      model,
      inputTokens,
      cachedTokens,
      outputTokens,
      costMicros,
    });

    return context.json({ ok: true });
  });

  routes.get("/mail", (context) => {
    const messages = listSinkMail().map((sent) => ({
      id: sent.id,
      to: sent.to,
      from: sent.from,
      subject: sent.subject,
      body: sent.body,
      sentAt: sent.sentAt,
    }));

    return context.json({ messages });
  });

  routes.post("/mail/clear", (context) => {
    clearSinkMail();

    return context.json({ ok: true });
  });

  routes.post("/user/name", zValidator("json", userNameBody), (context) => {
    const { email, name } = context.req.valid("json");

    db.update(users)
      .set({ name })
      .where(eq(users.email, lowercased(email)))
      .run();

    return context.json({ ok: true });
  });

  routes.post("/ledger/sample", zValidator("json", sampleLedgerBody), (context) => {
    const { email } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.email, lowercased(email)))
      .get();

    if (user === undefined) {
      return context.json({ error: "not found" }, 404);
    }

    grantApplications(db, clock, {
      idempotencyKey: `sample-grant:${user.id}`,
      quantity: SAMPLE_GRANT_QUANTITY,
      source: "admin",
      userId: user.id,
    });

    for (let index = 1; index <= 7; index += 1) {
      const applicationId = `sample-${String(index)}`;

      reserveForApplication(db, clock, {
        applicationId,
        idempotencyKey: `sample-reserve:${user.id}:${applicationId}`,
        userId: user.id,
      });

      commitForApplication(db, clock, {
        applicationId,
        idempotencyKey: `sample-commit:${user.id}:${applicationId}`,
        userId: user.id,
      });
    }

    return context.json({ applicationsLeft: applicationsLeft(db, user.id, clock.now()) });
  });

  routes.post("/ledger/tamper", zValidator("json", tamperLedgerBody), (context) => {
    const { action } = context.req.valid("json");
    const row = db.select().from(ledger).limit(1).get();

    if (row === undefined) {
      return context.json({ error: "no ledger rows" }, 404);
    }

    try {
      if (action === "update") {
        db.update(ledger)
          .set({ amount: row.amount + 1 })
          .where(eq(ledger.id, row.id))
          .run();
      } else if (action === "delete") {
        db.delete(ledger).where(eq(ledger.id, row.id)).run();
      } else {
        db.delete(users).where(eq(users.id, row.userId)).run();
      }

      return context.json({ refused: false, refusal: null });
    } catch (error) {
      const refusal = error instanceof Error ? error.message : String(error);

      return context.json({ refused: true, refusal });
    }
  });

  routes.get("/ledger/rows", (context) =>
    context.json({ rows: db.select().from(ledger).all().length }),
  );

  routes.get("/auth/state", (context) => {
    const allUsers = db.select().from(users).all();
    const allAccounts = db.select().from(accounts).all();
    const allSessions = db.select().from(sessions).all();

    return context.json({
      users: allUsers,
      accounts: allAccounts.map((account) => ({
        id: account.id,
        userId: account.userId,
        providerId: account.providerId,
        accountId: account.accountId,
      })),
      sessions: allSessions.map((session) => ({
        id: session.id,
        userId: session.userId,
        token: session.token,
        expiresAt: session.expiresAt,
      })),
    });
  });

  routes.post("/auth/role", zValidator("json", roleBody), (context) => {
    const { userId, role } = context.req.valid("json");

    const updated = db
      .update(users)
      .set({ role, updatedAt: new Date(clock.now()) })
      .where(eq(users.id, userId))
      .returning()
      .all();

    if (updated.length === 0) {
      return context.json({ error: "not found" }, 404);
    }

    return context.json({ userId, role });
  });

  return routes;
}
