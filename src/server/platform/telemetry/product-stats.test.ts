import { expect, test } from "bun:test";

import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

import { notePresence } from "../../auth/presence.ts";
import { grantApplications, reserveForApplication } from "../../billing/ledger.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { openDatabase } from "../db/client.ts";
import {
  applications,
  attempts,
  llmUsage,
  matches,
  profiles,
  sessions,
  users,
} from "../db/schema.ts";
import { createMetrics } from "./metrics.ts";
import { createPrometheusExporter, renderPrometheus } from "./prometheus.ts";
import { sampleProductStats, sampleProductStatsGuarded } from "./product-stats.ts";

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function seed() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  for (const [id, role, verified] of [
    ["a", "user", true],
    ["b", "user", false],
    ["demo", "demo", true],
  ] as const) {
    db.insert(users)
      .values({
        createdAt: new Date(NOW),
        email: `${id}@example.test`,
        emailVerified: verified,
        id,
        name: id,
        role,
        updatedAt: new Date(NOW),
      })
      .run();
  }

  db.insert(profiles)
    .values({
      createdAt: new Date(NOW),
      onboardedAt: new Date(NOW - HOUR),
      running: true,
      updatedAt: new Date(NOW),
      userId: "a",
    })
    .run();
  db.insert(sessions)
    .values([
      {
        createdAt: new Date(NOW - HOUR),
        expiresAt: new Date(NOW + HOUR),
        id: "s1",
        token: "s1",
        updatedAt: new Date(NOW - HOUR),
        userId: "a",
      },
      {
        createdAt: new Date(NOW - HOUR),
        expiresAt: new Date(NOW + HOUR),
        id: "s2",
        token: "s2",
        updatedAt: new Date(NOW - HOUR),
        userId: "a",
      },
      {
        createdAt: new Date(NOW - HOUR),
        expiresAt: new Date(NOW + HOUR),
        id: "s3",
        token: "s3",
        updatedAt: new Date(NOW - HOUR),
        userId: "demo",
      },
    ])
    .run();

  const base = {
    companyId: "c",
    companyName: "Ferro",
    companyNameNorm: "ferro",
    createdAt: NOW,
    origin: "pick" as const,
    postingTitle: "Nurse",
    postingUrl: "https://boards.example/1",
    updatedAt: NOW,
    userId: "a",
  };

  db.insert(applications)
    .values([
      { ...base, id: "app-1", postingId: "p1", status: "sent" },
      { ...base, id: "app-2", postingId: "p2", status: "ready" },
    ])
    .run();
  grantApplications(
    db,
    { now: () => NOW - HOUR },
    {
      idempotencyKey: "trial-a",
      quantity: 3,
      source: "trial",
      userId: "a",
    },
  );
  reserveForApplication(
    db,
    { now: () => NOW },
    {
      applicationId: "app-2",
      idempotencyKey: "reserve-app-2",
      userId: "a",
    },
  );
  db.insert(matches)
    .values([
      { codeRank: 1, postingId: "p1", score: 80, userId: "a" },
      { codeRank: 0.5, postingId: "p3", userId: "a" },
    ])
    .run();
  db.insert(llmUsage)
    .values({
      cachedTokens: 0,
      costMicros: 250_000,
      createdAt: NOW,
      id: "l1",
      inputTokens: 1,
      model: "claude-haiku-5-5",
      outputTokens: 1,
      purpose: "score",
      userId: "a",
    })
    .run();
  db.insert(attempts)
    .values({
      applicationId: "app-1",
      costMicros: 1_500_000,
      id: "t1",
      leaseUntil: NOW,
      n: 1,
      provider: "browser_use",
      startedAt: NOW - HOUR,
      userId: "a",
    })
    .run();

  return db;
}

test("samples people, applications, the queue, credits and spend into the product gauges", async () => {
  const db = seed();

  notePresence("a", NOW - 1000);
  notePresence("demo", NOW - 1000);

  const exporter = createPrometheusExporter();

  const provider = new MeterProvider({
    readers: [exporter],
    resource: resourceFromAttributes({ "service.name": "overture-test" }),
  });

  try {
    const recorder = createMetrics(provider.getMeter("overture-test"));

    sampleProductStats(db, NOW, recorder);

    expect(recorder.productGaugeValues("users")).toEqual({
      online: 1,
      onboarded: 1,
      running: 1,
      signed_in: 1,
      total: 2,
      verified: 1,
    });
    expect(recorder.productGaugeValues("productApplications")).toMatchObject({
      failed: 0,
      ready: 1,
      sent: 1,
    });
    expect(recorder.productGaugeValues("matchQueue")).toEqual({ pooled: 2, scored: 1 });
    expect(recorder.productGaugeValues("credits")).toEqual({
      available: 2,
      expired: 0,
      reserved: 1,
      used: 0,
    });
    expect(recorder.productGaugeValues("spendUsd")).toEqual({ browser: 1.5, llm: 0.25 });

    const output = await renderPrometheus(exporter);

    expect(output).toContain('overture_users{status="online"} 1');
    expect(output).toContain('overture_applications{status="sent"} 1');
    expect(output).toContain('overture_spend_usd{kind="browser"} 1.5');
    expect(output).not.toContain("user_id");
  } finally {
    await provider.shutdown();
  }
});

test("a status that empties stops reporting its old count", () => {
  const db = seed();
  const recorder = createMetrics(new MeterProvider().getMeter("overture-test"));

  recorder.setProductGauge("productApplications", { stale_status: 9 });
  sampleProductStats(db, NOW, recorder);

  expect(recorder.productGaugeValues("productApplications")).not.toHaveProperty("stale_status");
});

test("a slow sample reports how long it blocked the event loop", () => {
  const db = seed();
  const recorder = createMetrics(new MeterProvider().getMeter("overture-test"));
  const slowDurations: number[] = [];

  sampleProductStatsGuarded(db, NOW, recorder, {
    onSlow: (durationMs) => slowDurations.push(durationMs),
    slowMs: 0,
  });

  expect(slowDurations.length).toBe(1);
  expect(slowDurations[0]).toBeGreaterThanOrEqual(0);
  expect(recorder.productGaugeValues("matchQueue")).toEqual({ pooled: 2, scored: 1 });
});
