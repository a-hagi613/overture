import { expect, test } from "@playwright/test";

import type { LlmPort } from "../../src/server/platform/ports/llm.ts";
import type { SendPlanField } from "../../src/server/pipeline/send-plan.ts";

import { createClock } from "../../src/server/platform/ports/clock.ts";
import { migrateDatabase } from "../../src/server/platform/db/migrate.ts";
import { openDatabase } from "../../src/server/platform/db/client.ts";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

Bun.env.BETTER_AUTH_SECRET ??= "app-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

const { createPlanCache } = await import("../../src/server/pipeline/plan-cache.ts");

const { createFormSelfHealer } = await import("../../src/server/dispatch/forms/self-heal.ts");

const FORM = `<!doctype html>
<html><body>
<form id="application-form">
  <label for="legal-first">First name</label>
  <input id="legal-first" name="first_name" type="text" />
  <span id="moved-label">Referral source (moved by a board update)</span>
  <input id="moved-control" aria-labelledby="moved-label" name="moved_field" type="text" />
  <label for="confirm-email">Confirm email</label>
  <input id="confirm-email" name="confirmEmail" type="text" />
  <button id="submit-application" type="submit">Submit application</button>
</form>
</body></html>`;

const field = (overrides: Partial<SendPlanField> = {}) =>
  ({
    answer: "Careers page",
    answerKind: "fact",
    block: null,
    factRevision: 1,
    factKey: "how_did_you_hear",
    fieldName: "referral_source",
    fieldType: "text",
    file: null,
    label: "Referral source code",
    options: [],
    questionId: "question-referral",
    required: true,
    scope: "",
    sentences: [],
    source: "fact",
    unit: null,
    ...overrides,
  }) satisfies SendPlanField;

interface HealAnswer {
  action: "check" | "fill" | "radio" | "select";
  confidence: number;
  selector: string;
}

function llmAnswering(value: HealAnswer) {
  const requests: string[] = [];

  const llm: LlmPort = {
    estimateBatchCostMicros: () => 500,
    estimateSingleCostMicros: () => 0,
    runBatch: async (batch) => {
      requests.push(...batch.map((request) => request.user));

      await Promise.resolve();

      return batch.map((request) => ({
        cachedTokens: 0,
        cacheWriteTokens: 0,
        costMicros: 500,
        customId: request.customId,
        inputTokens: 100,
        model: "fake-haiku",
        outputTokens: 40,
        result: { ok: true as const, value },
      }));
    },
    runSingle: async () => {
      await Promise.resolve();

      throw new Error("self-heal must never use the single PDF call");
    },
  };

  return { llm, requests };
}

function freshStore() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { clock: createClock(), db };
}

function healerFor(llm: LlmPort, store: ReturnType<typeof freshStore>) {
  return createFormSelfHealer({
    cache: createPlanCache({ clock: store.clock, db: store.db }),
    clock: store.clock,
    db: store.db,
    llm,
  });
}

test("self-heals a renamed field from an ARIA snapshot, then replays the cached selector at $0", async ({
  page,
}) => {
  await page.setContent(FORM);

  await page.locator("#submit-application").evaluate((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();

      const clicks = Number(button.dataset["clicks"] ?? "0");

      button.dataset["clicks"] = String(clicks + 1);
    });
  });

  const answering = llmAnswering({
    action: "fill",
    confidence: 0.94,
    selector: "#moved-control",
  });

  const store = freshStore();
  const healer = healerFor(answering.llm, store);

  const scope = { page, root: page.locator("#application-form") };

  const input = {
    ats: "breezy" as const,
    field: field(),
    scope,
    signature: "heal-spec-1",
    userId: "user-1",
  };

  expect(await healer.healField({ ...input, runCap: new Set() })).toBe(true);
  await expect(page.locator("#moved-control")).toHaveValue("Careers page");

  expect(answering.requests.length).toBe(1);
  expect(answering.requests[0]).toContain("Referral source (moved by a board update)");

  const replaying = llmAnswering({ action: "fill", confidence: 0.1, selector: "#never" });
  const replayHealer = healerFor(replaying.llm, store);

  await page.locator("#moved-control").fill("");

  expect(await replayHealer.healField({ ...input, runCap: new Set() })).toBe(true);
  await expect(page.locator("#moved-control")).toHaveValue("Careers page");

  expect(replaying.requests.length).toBe(0);

  expect(
    await page
      .locator("#submit-application")
      .evaluate((button) => button.dataset["clicks"] ?? null),
  ).toBeNull();
});

test("refuses a suggestion that points at the Submit button and never clicks it", async ({
  page,
}) => {
  await page.setContent(FORM);

  await page.locator("#submit-application").evaluate((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();

      const clicks = Number(button.dataset["clicks"] ?? "0");

      button.dataset["clicks"] = String(clicks + 1);
    });
  });

  const answering = llmAnswering({
    action: "fill",
    confidence: 0.99,
    selector: "button[type='submit']",
  });

  const healer = healerFor(answering.llm, freshStore());

  const healed = await healer.healField({
    ats: "breezy",
    field: field(),
    runCap: new Set(),
    scope: { page, root: page.locator("#application-form") },
    signature: "heal-spec-submit",
    userId: "user-1",
  });

  expect(healed).toBe(false);
  expect(answering.requests.length).toBe(1);

  expect(
    await page
      .locator("#submit-application")
      .evaluate((button) => button.dataset["clicks"] ?? null),
  ).toBeNull();
  await expect(page.locator("#application-form")).toBeVisible();
});

test("accepts a legitimate control whose name contains a submit-like word", async ({ page }) => {
  await page.setContent(FORM);

  const answering = llmAnswering({
    action: "fill",
    confidence: 0.93,
    selector: "#confirm-email",
  });

  const healed = await healerFor(answering.llm, freshStore()).healField({
    ats: "breezy",
    field: field({
      answer: "maya@example.test",
      fieldName: "confirmEmail",
      label: "Confirm email",
    }),
    runCap: new Set(),
    scope: { page, root: page.locator("#application-form") },
    signature: "heal-spec-confirm",
    userId: "user-1",
  });

  expect(healed).toBe(true);
  await expect(page.locator("#confirm-email")).toHaveValue("maya@example.test");
  expect(
    await page
      .locator("#submit-application")
      .evaluate((button) => button.dataset["clicks"] ?? null),
  ).toBeNull();
});

test("caps self-healing at one attempt per form signature on a persistent failure", async ({
  page,
}) => {
  await page.setContent(FORM);

  const answering = llmAnswering({
    action: "fill",
    confidence: 0.9,
    selector: "#does-not-exist",
  });

  const healer = healerFor(answering.llm, freshStore());

  const input = {
    ats: "breezy" as const,
    field: field(),
    scope: { page, root: page.locator("#application-form") },
    signature: "heal-spec-cap",
    userId: "user-1",
  };

  expect(await healer.healField({ ...input, runCap: new Set() })).toBe(false);
  expect(answering.requests.length).toBe(1);

  expect(await healer.healField({ ...input, runCap: new Set() })).toBe(false);
  expect(answering.requests.length).toBe(1);
});
