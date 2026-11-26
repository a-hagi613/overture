import { expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import type { AlertMetrics } from "./alerts.ts";

Bun.env.BETTER_AUTH_SECRET ??= "alerts-observability-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "alerts-observability-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "alerts-observability-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const {
  CONFIRMING_STUCK_CEILING_MS,
  COST_PER_SENT_CEILING_MICROS,
  LLM_SCHEMA_REJECTION_CEILING,
  UNSCORED_BACKLOG_CEILING,
  drillAlertMetrics,
  evaluateAlerts,
} = await import("./alerts.ts");

const AT = Date.UTC(2026, 10, 25, 9, 0, 0);

const clock = { now: () => AT };

function quietMetrics() {
  const metrics: AlertMetrics = {
    ...drillAlertMetrics(),
    atsSuccess: [],
    backupLagSeconds: 0,
    backupReplication: "ok" as const,
    catalogWorkerCrashes: 0,
    codeChallenge: { attempted: 0, challengeRate: 0, codeRate: 0 },
    confirmingStuck: { applications: 0, oldestAgeMs: 0 },
    costPerSent: { applications: 0, costMicros: null },
    disk: { mount: "/", usedRatio: 0.1 },
    health: true,
    llmSchemaRejection: { accepted: 0, rate: null, rejected: 0 },
    llmSpend: [],
    mailForwarding: { bouncedOut: 0, failedAuthIn: 0, failedOut: 0 },
    mailHealth: { domain: { replies: 0, sent: 0 }, employers: [] },
    providerSuccess: [],
    queueOldestAgeMs: 0,
    unhandledRejections: 0,
    unscoredBacklog: 0,
  };

  return metrics;
}

function raisedFor(metrics: ReturnType<typeof quietMetrics>) {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  try {
    return evaluateAlerts(db, clock, metrics).raised;
  } finally {
    sqlite.close();
  }
}

test("an application stuck in Confirming raises its own alert", () => {
  const metrics = quietMetrics();

  metrics.confirmingStuck = { applications: 2, oldestAgeMs: CONFIRMING_STUCK_CEILING_MS + 1 };

  expect(raisedFor(metrics)).toContain("application.confirming_stuck");
});

test("cost per sent application only alerts over the gate with enough sends", () => {
  const tooFew = quietMetrics();

  tooFew.costPerSent = { applications: 2, costMicros: 10_000_000 };

  expect(raisedFor(tooFew)).not.toContain("application.cost");

  const expensive = quietMetrics();

  expensive.costPerSent = {
    applications: 10,
    costMicros: COST_PER_SENT_CEILING_MICROS + 1,
  };

  expect(raisedFor(expensive)).toContain("application.cost");
});

test("the unscored match backlog alerts only above its ceiling", () => {
  const atCeiling = quietMetrics();

  atCeiling.unscoredBacklog = UNSCORED_BACKLOG_CEILING;

  expect(raisedFor(atCeiling)).not.toContain("match.unscored");

  const over = quietMetrics();

  over.unscoredBacklog = UNSCORED_BACKLOG_CEILING + 1;

  expect(raisedFor(over)).toContain("match.unscored");
});

test("a bounced or failed forwarded copy raises the mail forwarding alert", () => {
  const bounced = quietMetrics();

  bounced.mailForwarding = { bouncedOut: 1, failedAuthIn: 0, failedOut: 0 };

  expect(raisedFor(bounced)).toContain("mail.forwarding");

  const failedAuth = quietMetrics();

  failedAuth.mailForwarding = { bouncedOut: 0, failedAuthIn: 1, failedOut: 0 };

  expect(raisedFor(failedAuth)).toContain("mail.forwarding");
});

test("the Haiku schema rejection rate alerts above its ceiling once there is a sample", () => {
  const smallSample = quietMetrics();

  smallSample.llmSchemaRejection = { accepted: 1, rate: 0.5, rejected: 1 };

  expect(raisedFor(smallSample)).not.toContain("llm.schema_rejection");

  const over = quietMetrics();

  over.llmSchemaRejection = {
    accepted: 80,
    rate: LLM_SCHEMA_REJECTION_CEILING + 0.1,
    rejected: 20,
  };

  expect(raisedFor(over)).toContain("llm.schema_rejection");
});
