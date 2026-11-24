import { afterEach, expect, test } from "bun:test";

import { Hono } from "hono";
import { z } from "zod";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { applications, attempts, users } from "../platform/db/schema.ts";
import {
  createInternalOpsHealthRoutes,
  OPS_HEALTH_PATH,
  OPS_HEALTH_SIGNATURE_HEADER,
  OPS_HEALTH_TIMESTAMP_HEADER,
  opsHealthSignature,
} from "./internal-ops.ts";

const NOW = 1_800_000_000_000;
const SECRET = "ops-health-test-secret";

const responseSchema = z.object({
  ats: z.object({
    attempts: z.number(),
    failureRate: z.number(),
    failures: z.number(),
    windowMs: z.number(),
  }),
  disk: z.object({ mount: z.string(), usedRatio: z.number() }),
  eventLoopLag: z.object({ p95Ms: z.number().nullable() }),
  memory: z.object({ rssBytes: z.number(), totalBytes: z.number(), usedRatio: z.number() }),
  status: z.string(),
});

type AttemptOutcome = NonNullable<(typeof attempts.$inferInsert)["outcome"]>;

const handles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }
});

function signedHeaders(timestamp = NOW, secret = SECRET) {
  return {
    [OPS_HEALTH_SIGNATURE_HEADER]: opsHealthSignature(secret, String(timestamp)),
    [OPS_HEALTH_TIMESTAMP_HEADER]: String(timestamp),
  };
}

function startApp(secret: string) {
  const { db, sqlite } = openDatabase(":memory:");

  handles.push(sqlite);
  migrateDatabase(db, "drizzle");

  const clock = { now: () => NOW };
  let sequence = 0;

  function seedAttempt(input: { at: number; outcome: AttemptOutcome }) {
    sequence += 1;

    const userId = "user-1";

    if (sequence === 1) {
      db.insert(users)
        .values({
          createdAt: new Date(NOW),
          email: "maya.okafor@example.com",
          emailVerified: true,
          id: userId,
          name: "Maya Okafor",
          role: "user",
          updatedAt: new Date(NOW),
        })
        .run();
    }

    const applicationId = `application-${String(sequence)}`;

    db.insert(applications)
      .values({
        ats: "greenhouse",
        companyId: "company-1",
        companyName: "Acme",
        companyNameNorm: "acme",
        createdAt: NOW,
        id: applicationId,
        origin: "auto",
        postingId: `posting-${String(sequence)}`,
        postingTitle: "Engineer",
        postingUrl: "https://example.test/job",
        status: "sent",
        updatedAt: NOW,
        userId,
      })
      .run();

    db.insert(attempts)
      .values({
        applicationId,
        captchaSeen: false,
        codeUsed: false,
        endedAt: input.at,
        id: `attempt-${String(sequence)}`,
        leaseUntil: input.at + 60_000,
        n: 1,
        outcome: input.outcome,
        provider: "local",
        startedAt: input.at,
        userId,
      })
      .run();
  }

  const app = new Hono();

  app.route(
    "/",
    createInternalOpsHealthRoutes({
      clock,
      databasePath: "/data/app.sqlite",
      db,
      eventLoopLagP95Ms: () => 42,
      readDisk: () => ({ usedRatio: 0.5 }),
      readMemory: () => ({ rssBytes: 512, totalBytes: 2048 }),
      secret,
    }),
  );

  return { app, seedAttempt };
}

test("a missing, stale or forged signature fails closed", async () => {
  const { app } = startApp(SECRET);

  const missing = await app.request(OPS_HEALTH_PATH);

  expect(missing.status).toBe(401);

  const stale = await app.request(OPS_HEALTH_PATH, {
    headers: signedHeaders(NOW - 10 * 60_000),
  });

  expect(stale.status).toBe(401);

  const forged = await app.request(OPS_HEALTH_PATH, {
    headers: {
      ...signedHeaders(),
      [OPS_HEALTH_SIGNATURE_HEADER]: "0".repeat(64),
    },
  });

  expect(forged.status).toBe(401);

  const emptySecret = startApp("");

  const forbidden = await emptySecret.app.request(OPS_HEALTH_PATH, { headers: signedHeaders() });

  expect(forbidden.status).toBe(403);
});

test("a valid signature answers memory, disk, lag and the ATS failure summary only", async () => {
  const { app } = startApp(SECRET);

  const response = await app.request(OPS_HEALTH_PATH, { headers: signedHeaders() });

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");

  const body = responseSchema.parse(await response.json());

  expect(body.status).toBe("ok");
  expect(body.memory).toEqual({ rssBytes: 512, totalBytes: 2048, usedRatio: 0.25 });
  expect(body.disk).toEqual({ mount: "/data", usedRatio: 0.5 });
  expect(body.eventLoopLag).toEqual({ p95Ms: 42 });
  expect(body.ats).toMatchObject({ attempts: 0, failureRate: 0, failures: 0 });

  const serialized = JSON.stringify(body);

  expect(serialized).not.toContain("user_id");
  expect(serialized).not.toContain("job_id");
  expect(serialized).not.toContain("email");
});

test("the ATS summary counts sent against every real attempt in the last hour", async () => {
  const { app, seedAttempt } = startApp(SECRET);

  seedAttempt({ at: NOW - 60_000, outcome: "sent" });
  seedAttempt({ at: NOW - 30_000, outcome: "captcha_blocked" });
  seedAttempt({ at: NOW - 3 * 60 * 60_000, outcome: "sent" });
  seedAttempt({ at: NOW - 60_000, outcome: "duplicate" });

  const response = await app.request(OPS_HEALTH_PATH, { headers: signedHeaders() });
  const body = responseSchema.parse(await response.json());

  expect(body.ats.attempts).toBe(2);
  expect(body.ats.failures).toBe(1);
  expect(body.ats.failureRate).toBeCloseTo(0.5);
});
