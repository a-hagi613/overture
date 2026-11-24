import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { applications, attempts, llmUsage, users } from "../platform/db/schema.ts";

Bun.env.BETTER_AUTH_SECRET ??= "application-cost-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "application-cost-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "application-cost-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { recordApplicationVariableCosts, recordedApplicationCostsByUser } =
  await import("./application-cost.ts");

const { APPLICATION_LLM_PURPOSES } = await import("./application-spend.ts");

const DAY_MS = 86_400_000;

type Database = ReturnType<typeof database>;

type ApplicationStatus = NonNullable<(typeof applications.$inferInsert)["status"]>;

type AttemptOutcome = NonNullable<(typeof attempts.$inferInsert)["outcome"]>;

function database() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function addUser(db: Database["db"], id: string, role: "user" | "demo" = "user") {
  db.insert(users)
    .values({
      createdAt: new Date(1),
      email: `${id}@example.com`,
      emailVerified: true,
      id,
      name: id,
      role,
      updatedAt: new Date(1),
    })
    .run();
}

function addApplication(
  db: Database["db"],
  input: { id: string; sentAt?: number | null; status: ApplicationStatus; userId: string },
) {
  db.insert(applications)
    .values({
      ats: "greenhouse",
      companyId: "company",
      companyName: "Engineer Co",
      companyNameNorm: "engineer co",
      createdAt: 1,
      id: input.id,
      origin: "auto",
      postingId: `posting-${input.id}`,
      postingTitle: "Engineer",
      postingUrl: `https://example.test/jobs/${input.id}`,
      sentAt: input.sentAt ?? null,
      status: input.status,
      updatedAt: 1,
      userId: input.userId,
    })
    .run();
}

function addAttempt(
  db: Database["db"],
  input: {
    applicationId: string;
    costMicros: number | null;
    id: string;
    outcome: AttemptOutcome;
    startedAt: number;
    submitClickedAt?: number | null;
    userId: string;
  },
) {
  db.insert(attempts)
    .values({
      applicationId: input.applicationId,
      browserMs: 60_000,
      captchaSeen: false,
      codeUsed: false,
      costMicros: input.costMicros,
      id: input.id,
      leaseUntil: input.startedAt + 15 * 60_000,
      n: 1,
      outcome: input.outcome,
      provider: "browser_use",
      startedAt: input.startedAt,
      submitClickedAt: input.submitClickedAt ?? null,
      userId: input.userId,
    })
    .run();
}

function addLlmUsage(db: Database["db"], input: { costMicros: number; userId: string }) {
  db.insert(llmUsage)
    .values({
      cachedTokens: 0,
      costMicros: input.costMicros,
      createdAt: 1000,
      id: crypto.randomUUID(),
      inputTokens: 100,
      model: "claude-sonnet-5",
      outputTokens: 100,
      purpose: APPLICATION_LLM_PURPOSES[0],
      userId: input.userId,
    })
    .run();
}

function costOf(db: Database["db"], applicationId: string) {
  const row = db
    .select({
      browserCostMicros: applications.browserCostMicros,
      costRecordedAt: applications.costRecordedAt,
      llmCostMicros: applications.llmCostMicros,
      retryCostMicros: applications.retryCostMicros,
    })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .get();

  if (row === undefined) {
    throw new Error("application missing");
  }

  return row;
}

describe("recording an Application's actual variable cost", () => {
  test("the migration adds the cost columns at zero with no stamp", () => {
    const { db } = database();

    addUser(db, "user-a");
    addApplication(db, { id: "app-a", status: "preparing", userId: "user-a" });

    expect(costOf(db, "app-a")).toEqual({
      browserCostMicros: 0,
      costRecordedAt: null,
      llmCostMicros: 0,
      retryCostMicros: 0,
    });
  });

  test("puts the sending try in browser cost and every earlier attempted try in retry cost", () => {
    const { db } = database();

    addUser(db, "user-a");
    addApplication(db, { id: "app-a", sentAt: 2000, status: "sent", userId: "user-a" });
    addAttempt(db, {
      applicationId: "app-a",
      costMicros: 5000,
      id: "try-1",
      outcome: "captcha_blocked",
      startedAt: 500,
      userId: "user-a",
    });
    addAttempt(db, {
      applicationId: "app-a",
      costMicros: 3000,
      id: "try-2",
      outcome: "sent",
      startedAt: 1500,
      submitClickedAt: 1800,
      userId: "user-a",
    });
    addLlmUsage(db, { costMicros: 4000, userId: "user-a" });

    expect(recordApplicationVariableCosts(db, { at: 9000, userId: "user-a" })).toBe(1);

    const [stored] = db.select().from(applications).all();

    expect(stored).toMatchObject({
      browserCostMicros: 3000,
      costRecordedAt: 9000,
      llmCostMicros: 4000,
      retryCostMicros: 5000,
    });
  });

  test("writes nothing twice and leaves the stamp alone when the data has not moved", () => {
    const { db } = database();

    addUser(db, "user-a");
    addApplication(db, { id: "app-a", sentAt: 2000, status: "sent", userId: "user-a" });
    addAttempt(db, {
      applicationId: "app-a",
      costMicros: 3000,
      id: "try-1",
      outcome: "sent",
      startedAt: 1000,
      userId: "user-a",
    });

    expect(recordApplicationVariableCosts(db, { at: 9000, userId: "user-a" })).toBe(1);
    expect(recordApplicationVariableCosts(db, { at: 10_000, userId: "user-a" })).toBe(0);
    expect(costOf(db, "app-a")).toMatchObject({
      browserCostMicros: 3000,
      costRecordedAt: 9000,
      retryCostMicros: 0,
    });
  });

  test("splits the person's model spend across completed Applications and keeps the remainder", () => {
    const { db } = database();

    addUser(db, "user-a");

    for (const [index, id] of ["old", "middle", "new"].entries()) {
      addApplication(db, {
        id: `app-${id}`,
        sentAt: 2000 + index,
        status: "sent",
        userId: "user-a",
      });
      addAttempt(db, {
        applicationId: `app-${id}`,
        costMicros: 1000,
        id: `try-${id}`,
        outcome: "sent",
        startedAt: 1000 + index,
        userId: "user-a",
      });
    }

    addLlmUsage(db, { costMicros: 10, userId: "user-a" });

    recordApplicationVariableCosts(db, { at: 9000, userId: "user-a" });

    expect(costOf(db, "app-old").llmCostMicros).toBe(4);
    expect(costOf(db, "app-middle").llmCostMicros).toBe(3);
    expect(costOf(db, "app-new").llmCostMicros).toBe(3);
  });

  test("keeps a failed Application's spend as retry cost and never gives it a model share", () => {
    const { db } = database();

    addUser(db, "user-a");
    addApplication(db, { id: "app-sent", sentAt: 2000, status: "sent", userId: "user-a" });
    addApplication(db, { id: "app-failed", status: "failed", userId: "user-a" });
    addAttempt(db, {
      applicationId: "app-sent",
      costMicros: 2000,
      id: "try-sent",
      outcome: "sent",
      startedAt: 1000,
      userId: "user-a",
    });
    addAttempt(db, {
      applicationId: "app-failed",
      costMicros: 7000,
      id: "try-failed",
      outcome: "crash",
      startedAt: 2000,
      userId: "user-a",
    });
    addLlmUsage(db, { costMicros: 3000, userId: "user-a" });

    recordApplicationVariableCosts(db, { at: 9000, userId: "user-a" });

    expect(costOf(db, "app-sent")).toMatchObject({
      browserCostMicros: 2000,
      llmCostMicros: 3000,
      retryCostMicros: 0,
    });
    expect(costOf(db, "app-failed")).toMatchObject({
      browserCostMicros: 0,
      llmCostMicros: 0,
      retryCostMicros: 7000,
    });
  });

  test("ignores tries that never counted as attempted Applications", () => {
    const { db } = database();

    addUser(db, "user-a");
    addApplication(db, { id: "app-a", sentAt: 2000, status: "sent", userId: "user-a" });

    const ignored = ["posting_closed", "duplicate", "needs_review"] as const;

    for (const [index, outcome] of ignored.entries()) {
      addAttempt(db, {
        applicationId: "app-a",
        costMicros: 4000,
        id: `try-${outcome}`,
        outcome,
        startedAt: 500 + index,
        userId: "user-a",
      });
    }

    addAttempt(db, {
      applicationId: "app-a",
      costMicros: 1000,
      id: "try-sent",
      outcome: "sent",
      startedAt: 1500,
      userId: "user-a",
    });

    recordApplicationVariableCosts(db, { at: 9000, userId: "user-a" });

    expect(costOf(db, "app-a")).toMatchObject({
      browserCostMicros: 1000,
      retryCostMicros: 0,
    });
  });

  test("counts the try that clicked submit as the sending one when email confirmed it", () => {
    const { db } = database();

    addUser(db, "user-a");
    addApplication(db, { id: "app-a", sentAt: 2000, status: "sent", userId: "user-a" });
    addAttempt(db, {
      applicationId: "app-a",
      costMicros: 6000,
      id: "try-1",
      outcome: "unconfirmed",
      startedAt: 1000,
      submitClickedAt: 1200,
      userId: "user-a",
    });

    recordApplicationVariableCosts(db, { at: 9000, userId: "user-a" });

    expect(costOf(db, "app-a")).toMatchObject({
      browserCostMicros: 6000,
      retryCostMicros: 0,
    });
  });
});

describe("the stored cost totals the margin view reads", () => {
  test("counts only completed Applications whose cost was measured inside the window", () => {
    const { db } = database();
    const now = 1_795_000_000_000;

    addUser(db, "user-a");
    addApplication(db, {
      id: "app-recent",
      sentAt: now - DAY_MS,
      status: "sent",
      userId: "user-a",
    });
    addApplication(db, {
      id: "app-old",
      sentAt: now - 40 * DAY_MS,
      status: "sent",
      userId: "user-a",
    });
    addApplication(db, { id: "app-failed", status: "failed", userId: "user-a" });

    for (const id of ["app-recent", "app-old", "app-failed"]) {
      addAttempt(db, {
        applicationId: id,
        costMicros: 1000,
        id: `try-${id}`,
        outcome: id === "app-failed" ? "crash" : "sent",
        startedAt: now - 40 * DAY_MS,
        userId: "user-a",
      });
    }

    recordApplicationVariableCosts(db, { at: now, userId: "user-a" });

    const inWindow = recordedApplicationCostsByUser(db, now - 30 * DAY_MS);

    expect(inWindow.get("user-a")).toEqual({
      applications: 1,
      browserMicros: 1000,
      llmMicros: 0,
      retryMicros: 0,
    });
  });

  test("leaves out demo users and Applications that never recorded a cost", () => {
    const { db } = database();
    const now = 1_795_000_000_000;

    addUser(db, "demo", "demo");
    addUser(db, "user-a");
    addApplication(db, {
      id: "app-demo",
      sentAt: now,
      status: "sent",
      userId: "demo",
    });
    addApplication(db, {
      id: "app-unmeasured",
      sentAt: now,
      status: "sent",
      userId: "user-a",
    });

    addAttempt(db, {
      applicationId: "app-demo",
      costMicros: 1000,
      id: "try-demo",
      outcome: "sent",
      startedAt: now,
      userId: "demo",
    });

    recordApplicationVariableCosts(db, { at: now, userId: "demo" });

    expect(recordedApplicationCostsByUser(db, now - 30 * DAY_MS).size).toBe(0);
  });
});
