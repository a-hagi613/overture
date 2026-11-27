import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startFeedFixtureServer } from "./feed-fixture-server.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const LIST_NAME = "Applications waiting on answers";

const test = appTest.extend<{
  grouped: { anthropic: AnthropicFixtureServer; server: AppServer };
}>({
  grouped: [
    async ({ identityServer }, provide) => {
      const anthropic = await startAnthropicFixtureServer();
      const feed = await startFeedFixtureServer();

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        GREENHOUSE_FEED_BASE_URL: feed.url,
      });

      await provide({ anthropic, server });
      await server.stop();
      feed.stop();
      anthropic.stop();
    },
    { scope: "test" },
  ],
});

const applicationRowSchema = z.object({
  id: z.string(),
  status: z.string(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const sharedQuestion = "Are you comfortable with a weekly on-call rotation?";
const sharedQuestionTwo = "How many years have you run Kubernetes in production?";

const kaseyaOnly = [
  "What is your notice period with your current employer?",
  "Which time zone do you work from?",
  "What is the largest production incident you have led?",
] as const;

const northwindOnly = "What is the best email address to reach you at?";

const kaseyaQuestions = [
  {
    text: sharedQuestion,
    fieldType: "select" as const,
    options: ["Yes", "No"],
    required: true,
    answerKind: "unknown" as const,
  },
  {
    text: sharedQuestionTwo,
    fieldType: "text" as const,
    required: true,
    answerKind: "unknown" as const,
  },
  {
    text: kaseyaOnly[0],
    fieldType: "textarea" as const,
    required: true,
    answerKind: "unknown" as const,
  },
  {
    text: kaseyaOnly[1],
    fieldType: "radio" as const,
    options: ["ET", "CT", "PT"],
    required: true,
    answerKind: "unknown" as const,
  },
  {
    text: kaseyaOnly[2],
    fieldType: "text" as const,
    required: true,
    answerKind: "unknown" as const,
  },
];

const northwindQuestions = [
  {
    text: sharedQuestion,
    fieldType: "select" as const,
    options: ["Yes", "No"],
    required: true,
    answerKind: "unknown" as const,
  },
  {
    text: sharedQuestionTwo,
    fieldType: "text" as const,
    required: true,
    answerKind: "unknown" as const,
  },
  {
    text: northwindOnly,
    fieldType: "email" as const,
    required: true,
    answerKind: "unknown" as const,
  },
];

async function seedGroupedBoard(owner: APIRequestContext, userId: string) {
  const kaseyaCompany = await seedCompany(owner, "Kaseya", "kaseya.example");
  const kaseyaBoard = await seedBoard(owner, kaseyaCompany, "greenhouse", "kaseya");

  const kaseyaPosting = await seedPosting(owner, {
    atsJobId: "grouped-kaseya",
    boardId: kaseyaBoard,
    companyId: kaseyaCompany,
    questions: kaseyaQuestions,
    tags: [{ dimension: "subrole", value: "Platform" }],
    title: "Senior Software Engineer",
    url: "https://kaseya.example/jobs/grouped-kaseya",
  });

  const northwindCompany = await seedCompany(owner, "Northwind Labs", "northwind.example");
  const northwindBoard = await seedBoard(owner, northwindCompany, "greenhouse", "northwind");

  const northwindPosting = await seedPosting(owner, {
    atsJobId: "grouped-northwind",
    boardId: northwindBoard,
    companyId: northwindCompany,
    questions: northwindQuestions,
    tags: [{ dimension: "subrole", value: "Platform" }],
    title: "Platform Engineer",
    url: "https://northwind.example/jobs/grouped-northwind",
  });

  const kaseya = await seedApplication(owner, {
    createdAt: 1,
    postingId: kaseyaPosting,
    status: "preparing",
    userId,
  });

  const northwind = await seedApplication(owner, {
    createdAt: 2,
    postingId: northwindPosting,
    status: "preparing",
    userId,
  });

  await Promise.all(
    [kaseya, northwind].map(async (applicationId) => {
      const response = await owner.post("/__test__/jobs/run-now", {
        data: {
          kind: "application.prepare",
          payload: JSON.stringify({ applicationId }),
        },
      });

      expect(response.ok()).toBe(true);
    }),
  );

  const rows = applicationsSchema.parse(
    await (await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)).json(),
  ).applications;

  expect(rows.find((row) => row.id === kaseya)?.status).toBe("needs_review");
  expect(rows.find((row) => row.id === northwind)?.status).toBe("needs_review");

  return { kaseya, northwind };
}

async function statusesFor(owner: APIRequestContext, userId: string) {
  const rows = applicationsSchema.parse(
    await (await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)).json(),
  ).applications;

  return new Map(rows.map((row) => [row.id, row.status]));
}

async function saveShots(page: Page, width: number, theme: string) {
  await page.screenshot({
    path: `test-results/review-grouped-${String(width)}-${theme}.png`,
    fullPage: true,
  });
}

async function watchToastOpacity(page: Page) {
  await page.evaluate(() => {
    const sample = () => {
      for (const toast of document.querySelectorAll<HTMLElement>("[data-sonner-toast]")) {
        if (
          toast.dataset.mounted === "true" &&
          toast.dataset.removed !== "true" &&
          toast.dataset.visible !== "false"
        ) {
          const seen = document.documentElement.dataset.toastOpacities ?? "";

          document.documentElement.dataset.toastOpacities = `${seen}${getComputedStyle(toast).opacity},`;
        }
      }

      requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });
}

async function expectToastsAtFullOpacity(page: Page) {
  const opacities = await page.evaluate(() =>
    (document.documentElement.dataset.toastOpacities ?? "")
      .split(",")
      .filter((value) => value !== "")
      .map(Number),
  );

  expect(opacities.length).toBeGreaterThan(0);
  expect(opacities.filter((opacity) => opacity < 1)).toEqual([]);
}

test("two applications with 5 and 3 questions and 2 shared move to Ready from one form each", async ({
  browser,
  grouped,
}) => {
  const { owner, userId } = await ownerContextFor(grouped.server.url);
  const { kaseya, northwind } = await seedGroupedBoard(owner, userId);

  const storageState = await owner.storageState();

  const context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  await page.goto(`${grouped.server.url}/review`);

  const list = page.getByRole("list", { name: LIST_NAME });

  await expect(list).toBeVisible();
  await expect(page.getByText("5 questions")).toBeVisible();
  await expect(page.getByText("3 questions")).toBeVisible();
  await expect(page.getByText("2 shared questions").first()).toBeVisible();

  await page.getByRole("button", { name: "Answer Kaseya: Senior Software Engineer" }).click();

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { exact: true, name: "Kaseya", level: 2 }),
  ).toBeVisible();
  await expect(dialog.getByText("Also used for 1 other application")).toHaveCount(2);
  await expect(dialog.getByText(sharedQuestion)).toBeVisible();
  await expect(dialog.getByText(sharedQuestionTwo)).toBeVisible();
  await expect(dialog.getByText(kaseyaOnly[1])).toBeVisible();

  const onCall = dialog.getByRole("group", { name: sharedQuestion });

  await onCall.getByRole("button", { name: "Yes" }).click();
  await dialog.getByRole("textbox", { name: sharedQuestionTwo }).fill("Six years");

  await dialog
    .getByRole("textbox", { name: kaseyaOnly[0] })
    .fill("I led an hour-long checkout outage and wrote the follow-up.");

  await dialog
    .getByRole("group", { name: kaseyaOnly[1] })
    .getByRole("button", { name: "ET" })
    .click();

  await dialog.getByRole("textbox", { name: kaseyaOnly[2] }).fill("A payments retry storm");

  await page.evaluate(() => {
    const sample = () => {
      for (const toast of document.querySelectorAll<HTMLElement>("[data-sonner-toast]")) {
        if (
          toast.dataset.mounted === "true" &&
          toast.dataset.removed !== "true" &&
          toast.dataset.visible !== "false"
        ) {
          const seen = document.documentElement.dataset.toastOpacities ?? "";

          document.documentElement.dataset.toastOpacities = `${seen}${getComputedStyle(toast).opacity},`;
        }
      }

      requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });

  await watchToastOpacity(page);

  const firstSave = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && candidate.url().endsWith("/api/reviews/answers"),
  );

  await dialog.getByRole("button", { name: "Save and continue" }).dispatchEvent("click");
  await firstSave;

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("5 questions")).toHaveCount(0);
  await expect(page.getByText("1 question")).toBeVisible();

  await page.getByRole("button", { name: "Answer Northwind Labs: Platform Engineer" }).click();

  const second = page.getByRole("dialog");

  await expect(second).toBeVisible();
  await expect(second.getByText("Also used for 1 other application")).toHaveCount(0);
  await expect(second.getByText(northwindOnly)).toBeVisible();

  await second.getByRole("textbox", { name: northwindOnly }).fill("maya.okafor@example.com");

  const secondSave = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && candidate.url().endsWith("/api/reviews/answers"),
  );

  await second.getByRole("button", { name: "Save and continue" }).dispatchEvent("click");
  await secondSave;

  const statuses = await statusesFor(owner, userId);

  expect(statuses.get(kaseya)).toBe("ready");
  expect(statuses.get(northwind)).toBe("ready");

  await expectToastsAtFullOpacity(page);

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow).toBe(false);

  await context.close();
  await owner.dispose();
});

async function expectReviewShell(
  browser: Browser,
  serverUrl: string,
  width: number,
  theme: string,
) {
  const { owner, userId } = await ownerContextFor(serverUrl);

  await seedGroupedBoard(owner, userId);

  const storageState = await owner.storageState();

  const context = await browser.newContext({
    storageState,
    viewport: { width, height: width === 1280 ? 900 : 844 },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${serverUrl}/review`);

  await expect(page.getByRole("list", { name: LIST_NAME })).toBeVisible();
  await saveShots(page, width, theme);

  await page.getByRole("button", { name: "Answer Kaseya: Senior Software Engineer" }).click();

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save and continue" })).toBeVisible();

  await dialog
    .getByRole("group", { name: sharedQuestion })
    .getByRole("button", { name: "Yes" })
    .click();
  await dialog.getByRole("textbox", { name: sharedQuestionTwo }).fill("Six years");
  await dialog.getByRole("textbox", { name: kaseyaOnly[0] }).fill("Four weeks");
  await dialog
    .getByRole("group", { name: kaseyaOnly[1] })
    .getByRole("button", { name: "ET" })
    .click();
  await dialog.getByRole("textbox", { name: kaseyaOnly[2] }).fill("A payments retry storm");

  await page.screenshot({
    path: `test-results/review-grouped-${String(width)}-${theme}-form.png`,
    fullPage: true,
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow, `${String(width)}px ${theme}`).toBe(false);

  await context.close();
  await owner.dispose();
}

for (const width of [390, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`the Review form stays inside ${String(width)}px in ${theme}`, async ({
      browser,
      grouped,
    }) => {
      await expectReviewShell(browser, grouped.server.url, width, theme);
    });
  }
}
