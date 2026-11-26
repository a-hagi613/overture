import { expect, test } from "bun:test";

import { openDatabase } from "../db/client.ts";
import { grants, users } from "../db/schema.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { setSetting } from "../settings/index.ts";

import { checkLlmCaps } from "./caps.ts";
import { recordLlmUsage } from "./usage.ts";

const AT = Date.UTC(2026, 10, 21, 9, 0, 0);
const DAY_MS = 24 * 60 * 60_000;
const fixedClock = { now: () => AT };

function freshDatabase() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { clock: fixedClock, db, sqlite };
}

function addUser(db: ReturnType<typeof freshDatabase>["db"], userId: string) {
  db.insert(users)
    .values({
      createdAt: new Date(AT),
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: userId,
      role: "user",
      updatedAt: new Date(AT),
    })
    .run();
}

function addPeriod(db: ReturnType<typeof freshDatabase>["db"], userId: string) {
  db.insert(grants)
    .values({
      createdAt: AT,
      expiresAt: AT + DAY_MS,
      id: crypto.randomUUID(),
      quantity: 50,
      source: "period",
      startsAt: AT - DAY_MS,
      userId,
    })
    .run();
}

function spend(
  db: ReturnType<typeof freshDatabase>["db"],
  at: { now: () => number },
  costMicros: number,
  userId: string | null = null,
) {
  recordLlmUsage(db, at, {
    cachedTokens: 0,
    costMicros,
    inputTokens: 1,
    model: "claude-haiku-5-5",
    outputTokens: 1,
    purpose: "score",
    userId,
  });
}

test("spend under the global budget is allowed and reports that ceiling", () => {
  const { db, sqlite, clock } = freshDatabase();

  try {
    addUser(db, "paying");
    addPeriod(db, "paying");
    spend(db, clock, 10_000_000);

    const caps = checkLlmCaps(db, clock, {
      estimatedCostMicros: 100_000,
      purpose: "score",
      userId: "paying",
    });

    expect(caps.withinCaps).toBe(true);
    expect(caps.capMicros).toBe(50_300_000);
  } finally {
    sqlite.close();
  }
});

test("a call over the fifty-dollar global budget fails closed", () => {
  const { db, sqlite, clock } = freshDatabase();

  try {
    spend(db, clock, 50_000_000);

    const caps = checkLlmCaps(db, clock, {
      estimatedCostMicros: 100_000,
      purpose: "score",
      userId: null,
    });

    expect(caps).toMatchObject({ capMicros: 50_000_000, exceeded: "global", withinCaps: false });
  } finally {
    sqlite.close();
  }
});

test("every person has the same ten-cent daily budget", () => {
  const { db, sqlite, clock } = freshDatabase();

  try {
    addUser(db, "paying");
    addUser(db, "invited");
    addPeriod(db, "paying");
    spend(db, clock, 120_000, "paying");
    spend(db, clock, 120_000, "invited");

    const paid = checkLlmCaps(db, clock, {
      estimatedCostMicros: 10_000,
      purpose: "score",
      userId: "paying",
    });

    const invited = checkLlmCaps(db, clock, {
      estimatedCostMicros: 10_000,
      purpose: "score",
      userId: "invited",
    });

    expect(paid).toMatchObject({ capMicros: 100_000, exceeded: "user", withinCaps: false });
    expect(invited).toMatchObject({ capMicros: 100_000, exceeded: "user", withinCaps: false });
  } finally {
    sqlite.close();
  }
});

test("the onboarding matching pool is spent once across days", () => {
  const { db, sqlite, clock } = freshDatabase();

  try {
    addUser(db, "new");

    const first = checkLlmCaps(db, clock, {
      estimatedCostMicros: 400_000,
      onboardingMatching: true,
      purpose: "score",
      userId: "new",
    });

    expect(first.withinCaps).toBe(true);

    spend(db, clock, 450_000, "new");

    const second = checkLlmCaps(db, clock, {
      estimatedCostMicros: 100_000,
      onboardingMatching: true,
      purpose: "score",
      userId: "new",
    });

    expect(second).toMatchObject({
      capMicros: 500_000,
      exceeded: "onboarding",
      withinCaps: false,
      spentMicros: 450_000,
    });
  } finally {
    sqlite.close();
  }
});

test("the tagging budget stays its own ceiling", () => {
  const { db, sqlite, clock } = freshDatabase();

  try {
    setSetting(db, clock, "llm.cap_tagging_day_usd", "0.5", "test");

    recordLlmUsage(db, clock, {
      cachedTokens: 0,
      costMicros: 450_000,
      inputTokens: 1,
      model: "claude-haiku-5-5",
      outputTokens: 1,
      purpose: "tag_fallback",
      userId: null,
    });

    const caps = checkLlmCaps(db, clock, {
      estimatedCostMicros: 100_000,
      purpose: "tag_fallback",
      userId: null,
    });

    expect(caps).toMatchObject({ capMicros: 500_000, exceeded: "tagging", withinCaps: false });
  } finally {
    sqlite.close();
  }
});
