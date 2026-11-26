import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { z } from "zod";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedBoard, seedBoardOwner } from "./board-harness.ts";
import type { AppServer } from "./app-server.ts";

const RETRY_AT = Date.UTC(2026, 10, 11, 13, 25);

const test = appTest.extend<{ drawerServer: AppServer }>({
  drawerServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const SHOT_DIR = process.env.JOB_DRAWER_SHOT_DIR ?? null;
const SHEET = 'dialog[aria-label="Application detail"]';
const mailSeedSchema = z.object({ messageId: z.string(), threadId: z.string() });

async function seedSentApplication(request: APIRequestContext, appServerUrl: string) {
  const userId = await seedBoardOwner(request, appServerUrl);

  const resume = await request.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "maya-okafor-resume.pdf",
      },
    },
  });

  expect(resume.ok()).toBe(true);

  const { selectedId } = await seedBoard(request, userId);

  const snapshot = await request.post("/__test__/snapshots/seed", {
    data: {
      answers: [
        {
          answer: "Toronto, ON",
          by_user: false,
          fact_key: "current_city",
          fact_revision: 1,
          kind: "fact",
          label: "Current city",
          question_id: "q-city",
          resume_line_ids: [],
        },
        {
          answer: "No",
          by_user: true,
          fact_key: "q:sponsorship",
          fact_revision: 1,
          kind: "open_text",
          label: "Will you need sponsorship?",
          question_id: "q-sponsorship",
          resume_line_ids: [],
        },
      ],
      applicationId: selectedId,
      confirmedBy: "page",
      coverLetter: [
        {
          resume_line_ids: ["L1"],
          sentence: "I led the migration of the order-intake pipeline.",
        },
        {
          by_user: true,
          resume_line_ids: [],
          sentence: "I would like to join your platform team.",
        },
      ],
    },
  });

  expect(snapshot.ok()).toBe(true);

  await request.post("/__test__/applications/events/seed", {
    data: {
      applicationId: selectedId,
      events: [
        {
          at: RETRY_AT,
          attemptId: "attempt-1",
          detail: null,
          fromValue: "sending",
          kind: "status",
          reason: "retry_scheduled",
          source: "system",
          toValue: "approved",
        },
      ],
    },
  });

  const before = readFileSync("test/e2e/fixtures/submit-screenshots/before-submit.png");
  const after = readFileSync("test/e2e/fixtures/submit-screenshots/after-submit.png");

  await Promise.all([
    request.post("/__test__/screenshots/seed", {
      data: {
        applicationId: selectedId,
        attemptId: "attempt-1",
        phase: "before_submit",
        pngBase64: before.toString("base64"),
      },
    }),
    request.post("/__test__/screenshots/seed", {
      data: {
        applicationId: selectedId,
        attemptId: "attempt-1",
        phase: "after_submit",
        pngBase64: after.toString("base64"),
      },
    }),
  ]);

  const mail = mailSeedSchema.parse(
    await (
      await request.post("/__test__/mail/seed", {
        data: {
          applicationId: selectedId,
          auth: "pass",
          classification: "ack",
          direction: "in",
          from: "Halden Systems <no-reply@halden.example>",
          senderDomain: "halden.example",
          subject: "We received your application",
          text: "Thank you for applying to Halden Systems. We will be in touch.",
          userId,
        },
      })
    ).json(),
  );

  await request.post("/__test__/receipts/seed", {
    data: { applicationId: selectedId, messageId: mail.messageId },
  });

  return { selectedId, userId };
}

async function openDrawer(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: "light" | "dark" = "light",
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });
  const { selectedId } = await seedSentApplication(request, appServerUrl);
  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  await page.setViewportSize({ height: width >= 1024 ? 900 : 844, width });
  await page.addInitScript((chosen: string) => {
    globalThis.localStorage.setItem("overture.theme", chosen);
    globalThis.localStorage.setItem("overture.rail", "1");
  }, theme);

  await page.goto(`${appServerUrl}/tracker?application=${encodeURIComponent(selectedId)}`);

  const drawer = page.getByRole("dialog", { name: "Application detail" });

  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Senior Backend Engineer" })).toBeVisible();

  return { context, drawer, page, selectedId };
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("a sent application's drawer shows the job, what was sent, the timeline and proof", async ({
  drawerServer,
  browser,
}) => {
  const { context, drawer, page } = await openDrawer(browser, drawerServer.url, 1280);

  const job = drawer.getByRole("region", { name: "Job" });

  await expect(job).toContainText("Halden Systems");
  await expect(job).toContainText("Toronto, ON");
  await expect(job).toContainText("Work mode not stated");
  await expect(job).toContainText("88% match");
  await expect(job).toContainText(
    "Strong match against your resume. Over the usual bar for sending.",
  );
  await expect(job.getByRole("link", { name: /Open original posting/u })).toBeVisible();

  await expect(
    drawer.getByText("Why: A send was interrupted and queued for the next sending slot."),
  ).toBeVisible();
  await expect(drawer.getByText("Send 1", { exact: true })).toBeVisible();

  await drawer.getByRole("tab", { name: "Answers" }).click();
  const answers = drawer.getByRole("tabpanel");

  await expect(answers.getByRole("heading", { name: "Resume version" })).toBeVisible();
  await expect(answers.getByText("maya-okafor-resume.pdf")).toBeVisible();
  await expect(answers.getByRole("heading", { name: "Answers as submitted" })).toBeVisible();
  await expect(answers.getByText("Current city")).toBeVisible();
  await expect(answers.getByText("Toronto, ON")).toBeVisible();
  await expect(answers.getByText("Will you need sponsorship?")).toBeVisible();
  await expect(answers.getByText("No", { exact: true })).toBeVisible();
  await expect(answers.getByText("From your saved answers")).toBeVisible();
  await expect(answers.getByText("Typed here")).toBeVisible();

  await drawer.getByRole("tab", { name: "Cover letter & resume" }).click();
  await expect(drawer.getByRole("heading", { name: "The file is sent as-is" })).toBeVisible();
  await expect(drawer.getByText("I led the migration of the order-intake pipeline.")).toBeVisible();
  await expect(drawer.getByText("I would like to join your platform team.")).toBeVisible();

  await drawer.getByRole("tab", { name: "Proof" }).click();
  const proof = drawer.getByRole("tabpanel");

  await expect(proof.getByRole("heading", { name: "Submit screenshots" })).toBeVisible();
  await expect(proof.getByRole("img", { name: "Before Submit" })).toBeVisible();
  await expect(proof.getByRole("img", { name: "After Submit" })).toBeVisible();
  await expect(proof.getByRole("heading", { name: "Confirmation receipt" })).toBeVisible();
  await expect(
    proof.getByText("Sent directly to Halden Systems’ careers page", { exact: false }),
  ).toBeVisible();
  await expect(proof.getByText("The employer's confirmation page was seen.")).toBeVisible();
  await expect(proof.getByText("Receipt message", { exact: false })).toBeVisible();
  await expect(proof.getByRole("heading", { name: "Linked mail" })).toBeVisible();
  await expect(proof.getByText("We received your application")).toBeVisible();
  await expect(
    proof.getByText("Halden Systems <no-reply@halden.example>", { exact: false }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).include(SHEET).analyze();

  expect(results.violations).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await context.close();
});

for (const width of [390, 1280]) {
  test(`the job drawer has no horizontal overflow at ${String(width)}px`, async ({
    drawerServer,
    browser,
  }) => {
    const { context, drawer, page } = await openDrawer(browser, drawerServer.url, width);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(drawer.getByRole("region", { name: "Job" })).toBeVisible();

    await drawer.getByRole("tab", { name: "Proof" }).click();
    await expect(drawer.getByRole("img", { name: "After Submit" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page }).include(SHEET).analyze();

    expect(results.violations).toEqual([]);

    await context.close();
  });
}

test("the drawer shows an empty proof state when no screenshots, receipt or mail exist", async ({
  drawerServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: drawerServer.url });
  const userId = await seedBoardOwner(request, drawerServer.url);
  const { selectedId } = await seedBoard(request, userId);
  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto(`${drawerServer.url}/tracker?application=${encodeURIComponent(selectedId)}`);
  await expect(page.getByRole("dialog", { name: "Application detail" })).toBeVisible();

  await page.getByRole("tab", { name: "Proof" }).click();

  await expect(page.getByText("No Submit screenshots were kept for this application.")).toHaveCount(
    1,
  );
  await expect(
    page.getByText("No confirmation receipt was recorded for this application."),
  ).toBeVisible();
  await expect(page.getByText("No mail is linked to this application yet.")).toBeVisible();

  await context.close();
});

test("Submit screenshots stay behind the signed-in owner", async ({ drawerServer }) => {
  const anonymous = await apiRequest.newContext({ baseURL: drawerServer.url });
  const response = await anonymous.get(
    "/api/applications/a-missing-application/screenshots/before_submit",
  );

  expect(response.status()).toBe(401);

  await anonymous.dispose();
});

test("captures the job drawer at 390 and 1280 in light and dark", async ({
  drawerServer,
  browser,
}) => {
  if (SHOT_DIR === null) {
    test.skip();

    return;
  }

  mkdirSync(SHOT_DIR, { recursive: true });

  const request = await apiRequest.newContext({ baseURL: drawerServer.url });
  const { selectedId } = await seedSentApplication(request, drawerServer.url);
  const storageState = await request.storageState();

  await request.dispose();

  const combinations = [
    { theme: "light" as const, width: 390 },
    { theme: "dark" as const, width: 390 },
    { theme: "light" as const, width: 1280 },
    { theme: "dark" as const, width: 1280 },
  ];

  await Promise.all(
    combinations.map(async ({ theme, width }) => {
      const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
      const page = await context.newPage();

      await page.setViewportSize({ height: width >= 1024 ? 900 : 844, width });
      await page.addInitScript((chosen: string) => {
        globalThis.localStorage.setItem("overture.theme", chosen);
        globalThis.localStorage.setItem("overture.rail", "1");
      }, theme);

      await page.goto(`${drawerServer.url}/tracker?application=${encodeURIComponent(selectedId)}`);
      await expect(page.getByRole("dialog", { name: "Application detail" })).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const base = `${String(width)}-${theme}`;

      await page.evaluate(() => {
        document
          .querySelector("dialog[aria-label='Application detail'] [data-scroll-region]")
          ?.scrollTo(0, 0);
      });

      await page.getByRole("dialog", { name: "Application detail" }).screenshot({
        animations: "disabled",
        caret: "hide",
        path: join(SHOT_DIR, `${base}-job.png`),
      });

      await page.getByRole("tab", { name: "Proof" }).click();
      await expect(page.getByRole("heading", { name: "Submit screenshots" })).toBeVisible();
      await expect(page.getByRole("img", { name: "After Submit" })).toBeVisible();
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));

      if (width === 390) {
        await page.setViewportSize({ height: 1400, width });
      }

      await page.getByRole("heading", { name: "Submit screenshots" }).scrollIntoViewIfNeeded();

      await page.getByRole("dialog", { name: "Application detail" }).screenshot({
        animations: "disabled",
        caret: "hide",
        path: join(SHOT_DIR, `${base}-proof.png`),
      });

      await context.close();
    }),
  );
});
