import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import {
  clockNow,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import { signInByMagicLink } from "./sign-in.ts";

const DAY = 24 * 60 * 60_000;

const LABEL = {
  feedUrl: "Calendar feed link",
  turnOn: "Turn on feed",
  rotate: "Rotate link",
  revoke: "Turn off feed",
} as const;

const WIDTHS = [390, 1280] as const;
const THEMES = ["light", "dark"] as const;

const SCREENSHOT_DIR = join(process.cwd(), "test-results", "calendar-ics");

async function feedPathOf(page: Page) {
  const url = await page.getByLabel(LABEL.feedUrl).inputValue();

  expect(url).toMatch(/\/calendar\/[A-Za-z0-9_-]{43}\.ics$/u);

  return new URL(url).pathname;
}

async function openSettings(page: Page, appServerUrl: string, width: number, theme: string) {
  await page.setViewportSize({ height: 900, width });
  await page.addInitScript((storedTheme) => {
    globalThis.localStorage.setItem("overture.theme", storedTheme);
  }, theme);

  await page.goto(`${appServerUrl}/settings`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("settings-calendar-feed")).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
}

async function expectControlsUnobscured(page: Page) {
  const obscured = await page.getByTestId("settings-calendar-feed").evaluate((card) => {
    const controls = [...card.querySelectorAll("button")];

    return controls.filter((control) => {
      control.scrollIntoView({ block: "center" });

      const box = control.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

      return hit === null || !control.contains(hit);
    }).length;
  });

  expect(obscured, "card controls covered by another element").toBe(0);
}

async function screenshotCard(page: Page, width: number, theme: string, label: string) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await expectControlsUnobscured(page);

  await page
    .getByTestId("settings-calendar-feed")
    .screenshot({ path: join(SCREENSHOT_DIR, `${label}-${String(width)}-${theme}.png`) });
}

test("the Settings feed card turns on, rotates and turns off a feed that calendar apps can read", async ({
  browser,
  isolatedAppServer,
}) => {
  const appServerUrl = isolatedAppServer.url;
  const { owner, userId } = await ownerContextFor(appServerUrl);
  const now = await clockNow(owner);

  const companyId = await seedCompany(owner, "Acme", "acme.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "calendar-ics");

  const postingId = await seedPosting(owner, {
    atsJobId: "calendar-ics",
    boardId,
    companyId,
    title: "Senior Backend Engineer",
    url: "https://acme.example/calendar-ics",
  });

  await seedApplication(owner, {
    postingId,
    sentAt: now - 2 * DAY,
    status: "sent",
    userId,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await signInByMagicLink(page, appServerUrl, owner, authTestIdentity.ownerEmail);
  await openSettings(page, appServerUrl, 1280, "light");

  await page.getByRole("button", { name: LABEL.turnOn, exact: true }).click();
  const firstPath = await feedPathOf(page);

  await screenshotCard(page, 1280, "light", "on");

  const anonymous = await apiRequest.newContext({ baseURL: appServerUrl });
  const feed = await anonymous.get(firstPath);

  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
  expect(feed.headers()["cache-control"]).toBe("private, no-store");

  const body = await feed.text();

  expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(body).toContain("BEGIN:VEVENT\r\n");
  expect(body).toContain("SUMMARY:Sent: Senior Backend Engineer at Acme\r\n");
  expect(body).toMatch(/^DTSTART;VALUE=DATE:\d{8}\r$/mu);
  expect(body).not.toMatch(/^(?:DESCRIPTION|ATTENDEE|ORGANIZER|URL)[:;]/mu);

  await page.getByRole("button", { name: LABEL.rotate, exact: true }).click();
  await expect.poll(async () => feedPathOf(page)).not.toBe(firstPath);
  const rotatedPath = await feedPathOf(page);
  expect((await anonymous.get(firstPath)).status()).toBe(404);
  expect((await anonymous.get(rotatedPath)).status()).toBe(200);

  await page.getByRole("button", { name: LABEL.revoke, exact: true }).click();
  await expect(page.getByLabel(LABEL.feedUrl)).toHaveCount(0);
  await expect(page.getByRole("button", { name: LABEL.turnOn, exact: true })).toBeVisible();
  expect((await anonymous.get(rotatedPath)).status()).toBe(404);

  await anonymous.dispose();
  await context.close();
});

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`the feed card has no overflow or axe violations and is captured at ${String(width)} ${theme}`, async ({
      browser,
      isolatedAppServer,
    }) => {
      const appServerUrl = isolatedAppServer.url;
      const { owner } = await ownerContextFor(appServerUrl);
      const context = await browser.newContext();
      const page = await context.newPage();

      await signInByMagicLink(page, appServerUrl, owner, authTestIdentity.ownerEmail);
      await openSettings(page, appServerUrl, width, theme);

      await page.getByRole("button", { name: LABEL.turnOn, exact: true }).click();
      await expect(page.getByLabel(LABEL.feedUrl)).toBeVisible();

      const overflow = await page.evaluate(() => {
        const root = document.documentElement;

        return root.scrollWidth - root.clientWidth;
      });

      expect(overflow, `horizontal overflow at ${String(width)} ${theme}`).toBeLessThanOrEqual(0);

      const { violations } = await new AxeBuilder({ page })
        .include('[data-testid="settings-calendar-feed"]')
        .analyze();

      expect(violations, `axe violations at ${String(width)} ${theme}`).toEqual([]);

      await screenshotCard(page, width, theme, "active");
      await context.close();
    });
  }
}
