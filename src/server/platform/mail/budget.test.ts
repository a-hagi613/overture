import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../db/client.ts";
import { mailUsage } from "../db/schema.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { setSetting } from "../settings/index.ts";
import {
  DEFAULT_MAIL_MONTHLY_CAP,
  DEFAULT_MAIL_SIGN_IN_RESERVE,
  MAIL_MONTHLY_CAP_KEY,
  MAIL_SIGN_IN_RESERVE_KEY,
  mailBudget,
  monthKey,
  readMailSummary,
  readMailUsage,
  reserveMailSend,
} from "./budget.ts";

const AT = Date.UTC(2026, 10, 21, 9, 0, 0);

function memoryDatabase() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

function clockAt(now: number) {
  return { now: () => now };
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
  const budget = mailBudget(memoryDatabase());

  expect(budget.cap).toBe(DEFAULT_MAIL_MONTHLY_CAP);
  expect(budget.reserve).toBe(DEFAULT_MAIL_SIGN_IN_RESERVE);
  expect(budget.noticeLimit).toBe(2430);
  expect(budget.warningAt).toBe(2160);
});

test("a bad setting falls back to the documented default", () => {
  const db = memoryDatabase();

  setSetting(db, clockAt(AT), MAIL_MONTHLY_CAP_KEY, "not-a-number", "test");
  setSetting(db, clockAt(AT), MAIL_SIGN_IN_RESERVE_KEY, "-5", "test");

  expect(mailBudget(db).cap).toBe(DEFAULT_MAIL_MONTHLY_CAP);
  expect(mailBudget(db).reserve).toBe(DEFAULT_MAIL_SIGN_IN_RESERVE);
});

test("a reserve larger than the cap leaves no room for notices", () => {
  const db = memoryDatabase();

  capAt(db, 5, 9);

  expect(mailBudget(db)).toMatchObject({ cap: 5, noticeLimit: 0, reserve: 5 });
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
  expect(refused.firstRefusal).toBe(true);

  expect(reserveMailSend(db, clock, "system").reason).toBeNull();
  expect(reserveMailSend(db, clock, "auth").reason).toBeNull();

  const stopped = reserveMailSend(db, clock, "auth");

  expect(stopped.reason).toBe("monthly_cap");
  expect(stopped.firstRefusal).toBe(false);
});

test("a full month refuses the 2,701st send and stays quiet after the first refusal", () => {
  const db = memoryDatabase();
  const clock = clockAt(AT);

  db.insert(mailUsage)
    .values({ authSends: 2700, month: monthKey(AT) })
    .run();

  const first = reserveMailSend(db, clock, "notice");

  expect(first).toMatchObject({ firstRefusal: true, reason: "monthly_cap" });
  expect(first.usage.total).toBe(2700);

  const again = reserveMailSend(db, clock, "notice");

  expect(again).toMatchObject({ firstRefusal: false, reason: "monthly_cap" });
  expect(readMailUsage(db, monthKey(AT)).refusedAt).toBe(AT);
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
