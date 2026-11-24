import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../db/client.ts";
import { grants, mailUsage, users } from "../db/schema.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { setSetting } from "../settings/index.ts";
import {
  DEFAULT_MAIL_MONTHLY_CAP,
  DEFAULT_MAIL_PER_SUBSCRIBER_CAP,
  DEFAULT_MAIL_SIGN_IN_RESERVE,
  MAIL_MONTHLY_CAP_KEY,
  MAIL_PER_SUBSCRIBER_CAP_KEY,
  MAIL_SIGN_IN_RESERVE_KEY,
  MAIL_WARNING_SHARE_KEY,
  mailBudget,
  monthKey,
  readMailSummary,
  readMailUsage,
  reserveMailSend,
} from "./budget.ts";

const AT = Date.UTC(2026, 10, 21, 9, 0, 0);
const DAY_MS = 24 * 60 * 60_000;

function memoryDatabase() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

function clockAt(now: number) {
  return { now: () => now };
}

function addGrant(
  db: ReturnType<typeof memoryDatabase>,
  userId: string,
  source: "admin" | "period" | "trial",
  expiry: number | null = AT + DAY_MS,
) {
  const existing = db.select({ id: users.id }).from(users).all();

  if (!existing.some((row) => row.id === userId)) {
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

  db.insert(grants)
    .values({
      createdAt: AT,
      expiresAt: expiry,
      id: crypto.randomUUID(),
      quantity: 50,
      source,
      startsAt: AT - DAY_MS,
      userId,
    })
    .run();
}

function capAt(db: ReturnType<typeof memoryDatabase>, cap: number, reserve: number) {
  const clock = clockAt(AT);

  setSetting(db, clock, MAIL_MONTHLY_CAP_KEY, String(cap), "test");
  setSetting(db, clock, MAIL_SIGN_IN_RESERVE_KEY, String(reserve), "test");
}

test("the month is the UTC calendar month", () => {
  expect(monthKey(AT)).toBe("2026-11");
  expect(monthKey(Date.UTC(2026, 11, 1, 0, 0, 0))).toBe("2026-12");
  expect(monthKey(Date.UTC(2026, 10, 30, 23, 59, 59))).toBe("2026-11");
});

test("the default budget stops at 2,700 with 270 kept back", () => {
  const budget = mailBudget(memoryDatabase(), AT);

  expect(budget.cap).toBe(DEFAULT_MAIL_MONTHLY_CAP);
  expect(budget.reserve).toBe(DEFAULT_MAIL_SIGN_IN_RESERVE);
  expect(budget.noticeLimit).toBe(2430);
  expect(budget.warningAt).toBe(2160);
});

test("a bad setting falls back to the documented default", () => {
  const db = memoryDatabase();

  setSetting(db, clockAt(AT), MAIL_MONTHLY_CAP_KEY, "not-a-number", "test");
  setSetting(db, clockAt(AT), MAIL_SIGN_IN_RESERVE_KEY, "-5", "test");

  expect(mailBudget(db, AT).cap).toBe(DEFAULT_MAIL_MONTHLY_CAP);
  expect(mailBudget(db, AT).reserve).toBe(DEFAULT_MAIL_SIGN_IN_RESERVE);
});

test("a reserve larger than the cap leaves no room for notices", () => {
  const db = memoryDatabase();

  capAt(db, 5, 9);

  expect(mailBudget(db, AT)).toMatchObject({ cap: 5, noticeLimit: 0, reserve: 5 });
});

test("every send is counted per kind and the month starts again", () => {
  const db = memoryDatabase();
  const clock = clockAt(AT);

  reserveMailSend(db, clock, "auth");
  reserveMailSend(db, clock, "system");
  reserveMailSend(db, clock, "notice");
  reserveMailSend(db, clock, "notice");

  expect(readMailUsage(db, monthKey(AT))).toMatchObject({
    auth: 1,
    notice: 2,
    system: 1,
    total: 4,
  });
  expect(readMailUsage(db, monthKey(Date.UTC(2026, 11, 2))).total).toBe(0);
});

test("the warning is raised once when the month crosses 80%", () => {
  const db = memoryDatabase();
  const clock = clockAt(AT);

  capAt(db, 10, 1);

  const warnings = [];

  for (let send = 0; send < 9; send += 1) {
    warnings.push(reserveMailSend(db, clock, "notice").warningRaised);
  }

  expect(warnings).toEqual([false, false, false, false, false, false, false, true, false]);
  expect(readMailUsage(db, monthKey(AT)).warnedAt).toBe(AT);
});

test("notices stop at the reserve while sign-in mail and the live check carry on", () => {
  const db = memoryDatabase();
  const clock = clockAt(AT);

  capAt(db, 10, 2);

  for (let send = 0; send < 8; send += 1) {
    expect(reserveMailSend(db, clock, "notice").reason).toBeNull();
  }

  const refused = reserveMailSend(db, clock, "notice");

  expect(refused.reason).toBe("sign_in_reserve");
  expect(refused.firstReserveRefusal).toBe(true);
  expect(refused.firstCapRefusal).toBe(false);

  expect(reserveMailSend(db, clock, "system").reason).toBeNull();
  expect(reserveMailSend(db, clock, "auth").reason).toBeNull();

  const stopped = reserveMailSend(db, clock, "auth");

  expect(stopped.reason).toBe("monthly_cap");
  expect(stopped.firstCapRefusal).toBe(true);
  expect(stopped.firstReserveRefusal).toBe(false);

  expect(readMailUsage(db, monthKey(AT))).toMatchObject({
    refusedAt: AT,
    reserveRefusedAt: AT,
    total: 10,
  });
});

test("the reserve alert does not hide the cap alert when sign-in mail finally breaks", () => {
  const db = memoryDatabase();
  const clock = clockAt(AT);

  capAt(db, 10, 2);

  for (let send = 0; send < 8; send += 1) {
    reserveMailSend(db, clock, "notice");
  }

  const atReserve = reserveMailSend(db, clock, "notice");

  expect(atReserve).toMatchObject({ firstCapRefusal: false, firstReserveRefusal: true });

  expect(reserveMailSend(db, clock, "auth").reason).toBeNull();
  expect(reserveMailSend(db, clock, "auth").reason).toBeNull();

  const atCap = reserveMailSend(db, clock, "auth");

  expect(atCap).toMatchObject({
    firstCapRefusal: true,
    firstReserveRefusal: false,
    reason: "monthly_cap",
  });

  const usage = readMailUsage(db, monthKey(AT));

  expect(usage.reserveRefusedAt).toBe(AT);
  expect(usage.refusedAt).toBe(AT);

  const quietAgain = reserveMailSend(db, clock, "notice");

  expect(quietAgain).toMatchObject({ firstCapRefusal: false, firstReserveRefusal: false });
});

test("a full month refuses the 2,701st send and stays quiet after the first refusal", () => {
  const db = memoryDatabase();
  const clock = clockAt(AT);

  db.insert(mailUsage)
    .values({ authSends: 2700, month: monthKey(AT) })
    .run();

  const first = reserveMailSend(db, clock, "notice");

  expect(first).toMatchObject({ firstCapRefusal: true, reason: "monthly_cap" });
  expect(first.usage.total).toBe(2700);

  const again = reserveMailSend(db, clock, "notice");

  expect(again).toMatchObject({ firstCapRefusal: false, reason: "monthly_cap" });
  expect(readMailUsage(db, monthKey(AT)).refusedAt).toBe(AT);
  expect(readMailUsage(db, monthKey(AT)).reserveRefusedAt).toBeNull();
});

test("a full month still stamps the cap when the reserve was already spent", () => {
  const db = memoryDatabase();
  const clock = clockAt(AT);

  db.insert(mailUsage)
    .values({ authSends: 2430, month: monthKey(AT), noticeSends: 270, reserveRefusedAt: AT - 1000 })
    .run();

  const first = reserveMailSend(db, clock, "auth");

  expect(first).toMatchObject({ firstCapRefusal: true, reason: "monthly_cap" });
  expect(first.usage.total).toBe(2700);
  expect(readMailUsage(db, monthKey(AT)).refusedAt).toBe(AT);
  expect(readMailUsage(db, monthKey(AT)).reserveRefusedAt).toBe(AT - 1000);
});

test("the counter survives reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-mail-usage-"));
  const path = join(directory, "app.db");
  const first = openDatabase(path);

  migrateDatabase(first.db, "drizzle");
  reserveMailSend(first.db, clockAt(AT), "auth");
  reserveMailSend(first.db, clockAt(AT), "notice");
  first.sqlite.close();

  const second = openDatabase(path);

  migrateDatabase(second.db, "drizzle");

  expect(readMailSummary(second.db, AT)).toMatchObject({ auth: 1, notice: 1, total: 2 });
  second.sqlite.close();
});

test("the month's cap grows by one Month allowance for every paying subscriber", () => {
  const db = memoryDatabase();

  addGrant(db, "paying-1", "period");
  addGrant(db, "paying-2", "period");

  const budget = mailBudget(db, AT);

  expect(budget).toMatchObject({
    baseCap: DEFAULT_MAIL_MONTHLY_CAP,
    cap: DEFAULT_MAIL_MONTHLY_CAP + 2 * DEFAULT_MAIL_PER_SUBSCRIBER_CAP,
    perSubscriber: DEFAULT_MAIL_PER_SUBSCRIBER_CAP,
    subscribers: 2,
  });
  expect(budget.warningAt).toBe(Math.ceil(budget.cap * 0.8));
});

test("admin and trial grants never grow the cap, and an ended period stops counting", () => {
  const db = memoryDatabase();

  addGrant(db, "invited", "admin", null);
  addGrant(db, "trialing", "trial");
  addGrant(db, "lapsed", "period", AT - 1);

  expect(mailBudget(db, AT)).toMatchObject({
    cap: DEFAULT_MAIL_MONTHLY_CAP,
    subscribers: 0,
  });
});

test("overlapping periods for one person count once", () => {
  const db = memoryDatabase();

  addGrant(db, "paying", "period");
  addGrant(db, "paying", "period", AT + 7 * DAY_MS);

  expect(mailBudget(db, AT).subscribers).toBe(1);
});

test("the admin sets the per-subscriber share and the warning share", () => {
  const db = memoryDatabase();

  setSetting(db, clockAt(AT), MAIL_PER_SUBSCRIBER_CAP_KEY, "100", "test");
  setSetting(db, clockAt(AT), MAIL_WARNING_SHARE_KEY, "0.5", "test");
  addGrant(db, "paying", "period");

  expect(mailBudget(db, AT)).toMatchObject({
    cap: DEFAULT_MAIL_MONTHLY_CAP + 100,
    perSubscriber: 100,
    subscribers: 1,
    warningAt: Math.ceil((DEFAULT_MAIL_MONTHLY_CAP + 100) * 0.5),
  });
});

test("a budget raised by paid growth no longer halts a paying subscriber's mail", () => {
  const db = memoryDatabase();
  const clock = clockAt(AT);

  addGrant(db, "paying", "period");

  db.insert(mailUsage)
    .values({ month: monthKey(AT), noticeSends: 2700 })
    .run();

  expect(reserveMailSend(db, clock, "auth").reason).toBeNull();
});
