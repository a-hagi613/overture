import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";

Bun.env.BETTER_AUTH_SECRET ??= "dry-submit-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "dry-submit-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "dry-submit-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const {
  DRY_SUBMIT_ENV,
  DRY_SUBMIT_PRODUCTION_REFUSAL,
  DrySubmitRefusedError,
  DrySubmitStoppedError,
  beforeSubmitStep,
  drySubmitActive,
  isDrySubmitValue,
  parseDrySubmitFlag,
} = await import("./dry-submit.ts");

const { openDatabase } = await import("../platform/db/client.ts");
const { migrateDatabase } = await import("../platform/db/migrate.ts");
const { applications, attempts, killSwitches, users } = await import("../platform/db/schema.ts");
const { evaluateKillSwitches } = await import("./kill-switches.ts");

const SENDERS = [
  "ashby",
  "browser-form",
  "greenhouse",
  "hosted",
  "lever",
  "personio",
  "workable",
] as const;

function sourceOf(name: string) {
  return readFileSync(join(import.meta.dir, "ats", `${name}.ts`), "utf8");
}

function executorSource() {
  return readFileSync(join(import.meta.dir, "executor.ts"), "utf8");
}

function mainSource() {
  return readFileSync(join(import.meta.dir, "..", "main.ts"), "utf8");
}

function database() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

async function failureOf(action: Promise<unknown>) {
  try {
    await action;

    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe("the dry-submit switch", () => {
  test("is off unless the operator writes 1 or true", () => {
    expect(parseDrySubmitFlag("1")).toBe(true);
    expect(parseDrySubmitFlag("true")).toBe(true);
    expect(parseDrySubmitFlag(" TRUE ")).toBe(true);

    for (const off of ["0", "false", "", "yes", "on", undefined]) {
      expect(parseDrySubmitFlag(off)).toBe(false);
    }
  });

  test("refuses a value it does not understand instead of guessing", () => {
    expect(isDrySubmitValue("1")).toBe(true);
    expect(isDrySubmitValue("true")).toBe(true);
    expect(isDrySubmitValue("0")).toBe(true);
    expect(isDrySubmitValue("false")).toBe(true);

    expect(isDrySubmitValue("yes")).toBe(false);
    expect(isDrySubmitValue("on")).toBe(false);
  });

  test("turns on outside production", () => {
    expect(drySubmitActive({ NODE_ENV: "development", OVERTURE_DRY_SUBMIT: true })).toBe(true);
    expect(drySubmitActive({ NODE_ENV: "test", OVERTURE_DRY_SUBMIT: true })).toBe(true);
    expect(drySubmitActive({ NODE_ENV: "test", OVERTURE_DRY_SUBMIT: false })).toBe(false);
    expect(drySubmitActive({ NODE_ENV: "production", OVERTURE_DRY_SUBMIT: false })).toBe(false);
  });

  test("fails loudly in production, so a deployed process can never dry-run or send", () => {
    expect(() => drySubmitActive({ NODE_ENV: "production", OVERTURE_DRY_SUBMIT: true })).toThrow(
      DrySubmitRefusedError,
    );

    expect(() => drySubmitActive({ NODE_ENV: "production", OVERTURE_DRY_SUBMIT: true })).toThrow(
      DRY_SUBMIT_PRODUCTION_REFUSAL,
    );

    expect(DRY_SUBMIT_ENV).toBe("OVERTURE_DRY_SUBMIT");
  });
});

describe("the pre-Submit step every sender runs", () => {
  test("a normal send keeps the evidence shot and marks the click", async () => {
    const order: string[] = [];

    await beforeSubmitStep({
      captureEvidence: () => {
        order.push("screenshot");
      },
      drySubmit: false,
      markSubmitClicked: () => {
        order.push("click");
      },
    });

    expect(order).toEqual(["screenshot", "click"]);
  });

  test("a dry submit keeps the screenshot and stops before the click", async () => {
    const order: string[] = [];
    let clicked = false;

    const failure = await failureOf(
      beforeSubmitStep({
        captureEvidence: () => {
          order.push("screenshot");
        },
        drySubmit: true,
        markSubmitClicked: () => {
          clicked = true;
          order.push("click");
        },
      }),
    );

    expect(failure).toBeInstanceOf(DrySubmitStoppedError);
    expect(order).toEqual(["screenshot"]);
    expect(clicked).toBe(false);
  });

  test("a broken screenshot still stops instead of submitting", async () => {
    let clicked = false;

    const failure = await failureOf(
      beforeSubmitStep({
        captureEvidence: async () => {
          await Promise.reject(new Error("the store is down"));
        },
        drySubmit: true,
        markSubmitClicked: () => {
          clicked = true;
        },
      }),
    );

    expect(failure?.message).toBe("the store is down");
    expect(clicked).toBe(false);
  });
});

describe("the executor wiring", () => {
  test("main resolves the switch from parsed config and passes it into dispatch", () => {
    expect(mainSource()).toContain("drySubmit: drySubmitActive(env),");
    expect(executorSource()).toContain("drySubmit: boolean;");
    expect(executorSource()).toContain("if (error instanceof DrySubmitStoppedError) {");
    expect(executorSource()).toContain('outcome: "dry_submit"');
  });

  test("the onWillSubmit hook always runs the shared pre-Submit step", () => {
    const executor = executorSource();
    const hookStart = executor.indexOf("onWillSubmit: async () => {");
    const requestCode = executor.indexOf("requestCode: async () => {", hookStart);

    expect(hookStart).toBeGreaterThan(-1);
    expect(requestCode).toBeGreaterThan(hookStart);

    const hook = executor.slice(hookStart, requestCode);

    expect(hook).toContain("beforeSubmitStep({");
    expect(hook).toContain("drySubmit,");
    expect(hook).toContain("markSubmitClicked: () => {");
    expect(hook.match(/submitClickedAt/gu)).toHaveLength(1);
  });

  test("every sender still calls onWillSubmit before its Submit click", () => {
    for (const name of SENDERS) {
      const source = sourceOf(name);
      const hookIndex = source.indexOf("await hooks.onWillSubmit();");

      expect(hookIndex).toBeGreaterThan(-1);
      expect(source.indexOf(".click(", hookIndex)).toBeGreaterThan(hookIndex);
    }
  });
});

describe("a dry submit never looks like a provider result", () => {
  test("fifty dry attempts do not trip the provider or ATS kill switches", () => {
    const { db } = database();

    db.insert(users)
      .values({
        createdAt: new Date(1),
        email: "dry@example.test",
        emailVerified: true,
        id: "user-dry",
        name: "dry",
        role: "user",
        updatedAt: new Date(1),
      })
      .run();

    db.insert(applications)
      .values({
        ats: "lever",
        companyId: "company",
        companyName: "Engineer Co",
        companyNameNorm: "engineer co",
        createdAt: 1,
        id: "app-dry",
        origin: "auto",
        postingId: "posting-dry",
        postingTitle: "Engineer",
        postingUrl: "https://example.test/jobs/dry",
        status: "ready",
        updatedAt: 1,
        userId: "user-dry",
      })
      .run();

    for (let index = 0; index < 50; index += 1) {
      db.insert(attempts)
        .values({
          applicationId: "app-dry",
          captchaSeen: false,
          codeUsed: false,
          endedAt: 1000 + index,
          id: `attempt-dry-${String(index)}`,
          leaseUntil: 2000 + index,
          n: index + 1,
          outcome: "dry_submit",
          provider: "browser_use",
          startedAt: 1000 + index,
          userId: "user-dry",
        })
        .run();
    }

    const report = evaluateKillSwitches({
      clock: { now: () => 2000 },
      db,
    });

    expect(report.tripped).toEqual([]);
    expect(db.select().from(killSwitches).where(eq(killSwitches.key, "lever")).all()).toEqual([]);
    expect(db.select().from(killSwitches).where(eq(killSwitches.key, "browser_use")).all()).toEqual(
      [],
    );
  });
});
