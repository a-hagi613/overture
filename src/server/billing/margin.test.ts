import { expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { applications, attempts, grants, llmUsage, users } from "../platform/db/schema.ts";

import {
  netRevenueMicrosPerApplication,
  STRIPE_DOMESTIC_FEE_RATE,
  STRIPE_INTERNATIONAL_FEE_RATE,
  stripeFeeMicros,
} from "./stripe-fees.ts";

Bun.env.BETTER_AUTH_SECRET ??= "margin-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "margin-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "margin-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const {
  actualApplicationCost,
  buildMarginReport,
  MONTH_NET_MICROS_PER_APPLICATION,
  WEEK_NET_MICROS_PER_APPLICATION,
} = await import("./margin.ts");

const { recordApplicationVariableCosts } = await import("../dispatch/application-cost.ts");
const { APPLICATION_LLM_PURPOSES } = await import("../dispatch/application-spend.ts");

const DAY_MS = 86_400_000;
const NOW = 1_795_000_000_000;

const WEEK_PRICE_MICROS = 9_990_000;
const MONTH_PRICE_MICROS = 29_990_000;
const WEEK_APPLICATIONS = 50;
const MONTH_APPLICATIONS = 250;

test("regular Stripe Billing charges 3.6 % + $0.30 domestic and 5.1 % + $0.30 international", () => {
  expect(STRIPE_DOMESTIC_FEE_RATE).toBeCloseTo(0.036, 10);
  expect(STRIPE_INTERNATIONAL_FEE_RATE).toBeCloseTo(0.051, 10);

  expect(stripeFeeMicros(WEEK_PRICE_MICROS, STRIPE_DOMESTIC_FEE_RATE)).toBe(660_000);
  expect(stripeFeeMicros(MONTH_PRICE_MICROS, STRIPE_DOMESTIC_FEE_RATE)).toBe(1_380_000);
  expect(stripeFeeMicros(WEEK_PRICE_MICROS, STRIPE_INTERNATIONAL_FEE_RATE)).toBe(810_000);
  expect(stripeFeeMicros(MONTH_PRICE_MICROS, STRIPE_INTERNATIONAL_FEE_RATE)).toBe(1_830_000);
});

test("a free price carries no Stripe fee", () => {
  expect(stripeFeeMicros(0, STRIPE_DOMESTIC_FEE_RATE)).toBe(0);
});

test("net revenue baselines are $0.187 an Application on Week and $0.114 on Month", () => {
  expect(netRevenueMicrosPerApplication(WEEK_PRICE_MICROS, WEEK_APPLICATIONS)).toBe(186_600);
  expect(netRevenueMicrosPerApplication(MONTH_PRICE_MICROS, MONTH_APPLICATIONS)).toBe(114_440);
});

test("the international baselines are $0.184 on Week and $0.113 on Month", () => {
  expect(
    netRevenueMicrosPerApplication(
      WEEK_PRICE_MICROS,
      WEEK_APPLICATIONS,
      STRIPE_INTERNATIONAL_FEE_RATE,
    ),
  ).toBe(183_600);
  expect(
    netRevenueMicrosPerApplication(
      MONTH_PRICE_MICROS,
      MONTH_APPLICATIONS,
      STRIPE_INTERNATIONAL_FEE_RATE,
    ),
  ).toBe(112_640);
});

test("the baseline constants are the $0.114 Month and $0.187 Week net per Application", () => {
  expect(MONTH_NET_MICROS_PER_APPLICATION).toBe(114_440);
  expect(WEEK_NET_MICROS_PER_APPLICATION).toBe(186_600);
});

test("the actual cost per Application averages over the Applications that reported one", () => {
  expect(
    actualApplicationCost({ applications: 0, browserMicros: 0, llmMicros: 0, retryMicros: 0 }),
  ).toBeNull();

  expect(
    actualApplicationCost({
      applications: 3,
      browserMicros: 9000,
      llmMicros: 4500,
      retryMicros: 1500,
    }),
  ).toEqual({
    applications: 3,
    browserMicrosPerApplication: 3000,
    llmMicrosPerApplication: 1500,
    retryMicrosPerApplication: 500,
    totalMicrosPerApplication: 5000,
  });
});

test("the margin report carries the stored breakdown per plan and overall", () => {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "pays@example.com",
      emailVerified: true,
      id: "pays",
      name: "Pays",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();
  db.insert(grants)
    .values({
      createdAt: NOW,
      expiresAt: NOW + 20 * DAY_MS,
      id: "grant-month",
      quantity: 250,
      source: "period",
      startsAt: NOW,
      userId: "pays",
    })
    .run();
  db.insert(applications)
    .values({
      ats: "greenhouse",
      companyId: "company",
      companyName: "Engineer Co",
      companyNameNorm: "engineer co",
      createdAt: NOW,
      id: "app-a",
      origin: "pick",
      postingId: "posting-a",
      postingTitle: "Engineer",
      postingUrl: "https://example.test/jobs/a",
      sentAt: NOW,
      status: "sent",
      updatedAt: NOW,
      userId: "pays",
    })
    .run();

  const outcomes = ["captcha_blocked", "sent"] as const;

  for (const [index, outcome] of outcomes.entries()) {
    db.insert(attempts)
      .values({
        applicationId: "app-a",
        browserMs: 60_000,
        captchaSeen: false,
        codeUsed: false,
        costMicros: index === 0 ? 5000 : 3000,
        id: `try-${String(index)}`,
        leaseUntil: NOW,
        n: index + 1,
        outcome,
        provider: "browser_use",
        startedAt: NOW - 60_000 + index,
        userId: "pays",
      })
      .run();
  }

  db.insert(llmUsage)
    .values({
      cachedTokens: 0,
      costMicros: 4000,
      createdAt: NOW,
      id: "llm-1",
      inputTokens: 100,
      model: "claude-sonnet-5",
      outputTokens: 100,
      purpose: APPLICATION_LLM_PURPOSES[0],
      userId: "pays",
    })
    .run();

  recordApplicationVariableCosts(db, { at: NOW, userId: "pays" });

  const report = buildMarginReport(db, { now: () => NOW });

  const expected = {
    applications: 1,
    browserMicrosPerApplication: 3000,
    llmMicrosPerApplication: 4000,
    retryMicrosPerApplication: 5000,
    totalMicrosPerApplication: 12_000,
  };

  expect(report.actual).toEqual(expected);

  const month = report.plans.find((row) => row.plan === "month");

  expect(month?.applications).toBe(250);
  expect(month?.actual).toEqual(expected);
  expect(report.plans.find((row) => row.plan === "week")?.actual).toBeNull();
});
