import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import type { Browser, BrowserContext } from "@playwright/test";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const SHOT_DIR = process.env.WS695_SHOT_DIR;

const SIZES = [
  { height: 844, width: 390 },
  { height: 860, width: 1280 },
] as const;

const THEMES = ["light", "dark"] as const;

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function expectLookupPage(
  browser: Browser,
  adminUrl: string,
  state: StorageState,
  applicationId: string,
  width: number,
  height: number,
  theme: (typeof THEMES)[number],
) {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();

  try {
    await page.addInitScript((stored) => {
      globalThis.localStorage.setItem("overture.theme", stored);
    }, theme);
    await page.setViewportSize({ height, width });
    await page.goto(`${adminUrl}/admin/lookup?application=${encodeURIComponent(applicationId)}`);

    await expect(page.getByRole("heading", { name: "Application lookup" })).toBeVisible();
    await expect(page.getByText("Ferro Cloud · Senior Platform Engineer")).toBeVisible();
    await expect(page.getByText("deploy_interruption")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Send attempts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Balance and ledger" })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));

    expect(
      overflow.scroll,
      `horizontal overflow at ${String(width)}px ${theme}`,
    ).toBeLessThanOrEqual(overflow.client);

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(axe.violations, `axe violations at ${String(width)}px ${theme}`).toEqual([]);

    if (SHOT_DIR !== undefined) {
      mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({
        fullPage: true,
        path: join(SHOT_DIR, `lookup-${String(width)}-${theme}.png`),
      });
    }
  } finally {
    await context.close();
  }
}

test("the owner traces an application by id across the whole flow", async ({
  accessServer,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  browser,
  page,
}) => {
  test.setTimeout(180_000);

  const { owner, userId } = await ownerContextFor(adminIsolatedAppServer.url);
  const companyId = await seedCompany(owner, "Ferro Cloud", "ferro.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "ws695");
  const postingId = await seedPosting(owner, {
    atsJobId: "ws695-1",
    boardId,
    companyId,
    title: "Senior Platform Engineer",
    url: "https://ferro.example/jobs/ws695-1",
  });
  const applicationId = await seedApplication(owner, {
    postingId,
    status: "confirming",
    userId,
  });
  const eventAt = Date.now() - 60_000;

  const events = await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId,
      events: [
        {
          at: eventAt,
          detail: JSON.stringify({ attemptId: "attempt-ws695", reason: "deploy_interruption" }),
          fromValue: "sending",
          kind: "status",
          source: "system",
          toValue: "confirming",
        },
      ],
    },
  });

  expect(events.status()).toBe(200);

  const attempt = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId,
      browserMs: 45_000,
      costMicros: 9_500,
      n: 1,
      outcome: "unconfirmed",
      provider: "browser_use",
      userId,
    },
  });

  expect(attempt.status()).toBe(200);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  const state = await page.context().storageState();

  for (const { height, width } of SIZES) {
    for (const theme of THEMES) {
      await expectLookupPage(
        browser,
        adminIsolatedAppUrl,
        state,
        applicationId,
        width,
        height,
        theme,
      );
    }
  }
});
