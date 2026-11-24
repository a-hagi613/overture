import { AxeBuilder } from "@axe-core/playwright";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { expect, test } from "./app.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const NOVEMBER = "/calendar?month=2026-11";
const SENT_ON_17TH = Date.UTC(2026, 10, 17, 9, 12);
const SENT_ON_16TH = Date.UTC(2026, 10, 16, 8, 30);
const EMPLOYERS = ["Halden Systems", "Northwind Labs", "Ferro Cloud", "Quill Works"] as const;

type Seeded = Awaited<ReturnType<typeof seedMonth>>;

async function seedMonth(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  const applicationIds = await Promise.all(
    EMPLOYERS.map(async (name, index) => {
      const slug = name.replaceAll(" ", "").toLowerCase();
      const atsJobId = `calendar-${String(index)}`;
      const companyId = await seedCompany(owner, name, `${slug}.example`);
      const boardId = await seedBoard(owner, companyId, "greenhouse", atsJobId);

      const postingId = await seedPosting(owner, {
        atsJobId,
        boardId,
        companyId,
        title: "Platform Engineer",
        url: `https://${slug}.example/${String(index)}`,
      });

      return seedApplication(owner, {
        postingId,
        sentAt: index === 3 ? SENT_ON_16TH : SENT_ON_17TH + index * 28 * 60_000,
        status: "sent",
        userId,
      });
    }),
  );

  return { applicationIds, owner, server };
}

async function moveClockTo(request: APIRequestContext, target: number) {
  const current = z
    .object({ now: z.number(), offsetMs: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  const moved = await request.post("/__test__/clock/offset", {
    data: { offsetMs: target - current.now + current.offsetMs },
  });

  expect(moved.ok()).toBe(true);
}

async function openCalendar(
  browser: Browser,
  seeded: Seeded,
  options: {
    beforeGoto?: (page: Page) => Promise<void>;
    dark?: boolean;
    timezoneId?: string;
    width: number;
    path?: string;
  },
) {
  const context = await browser.newContext({
    storageState: await seeded.owner.storageState(),
    timezoneId: options.timezoneId ?? "UTC",
    viewport: { height: options.width < 768 ? 844 : 900, width: options.width },
  });

  if (options.dark === true) {
    await context.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  const page = await context.newPage();

  await options.beforeGoto?.(page);
  await page.goto(`${seeded.server.url}${options.path ?? NOVEMBER}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  return { context, page };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
}

test("the month grid shows each day's events and the day panel lists them", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);
  const { context, page } = await openCalendar(browser, seeded, { width: 1280 });

  const grid = page.getByRole("grid");

  await expect(grid).toBeVisible();
  await expect(grid.locator("button[data-day]")).toHaveCount(42);
  await expect(
    grid.getByRole("button", { name: "Tuesday, November 17, 2026, 3 sent" }),
  ).toBeVisible();
  await expect(
    grid.getByRole("button", { name: "Monday, November 16, 2026, 1 sent" }),
  ).toBeVisible();
  await expect(
    grid.getByRole("button", { name: "Wednesday, November 18, 2026, nothing" }),
  ).toBeVisible();

  await grid.getByRole("button", { name: "Tuesday, November 17, 2026, 3 sent" }).click();

  const panel = page.getByRole("complementary", { name: "Day panel" });

  await expect(panel.getByRole("heading", { name: "Tue, Nov 17" })).toBeVisible();
  await expect(panel.getByText("3 sent")).toBeVisible();
  await expect(panel.getByRole("link", { name: "View in Applications" })).toHaveCount(3);
  await expect(panel).toContainText("Halden Systems");
  await expect(panel).toContainText("09:12");

  await panel.getByRole("link", { name: "View in Applications" }).first().click();
  await expect(page).toHaveURL(/\/applications\?card=/u);

  await page.goBack();
  await expectNoHorizontalOverflow(page);

  await context.close();
  await seeded.owner.dispose();
});

test("the grid follows the WAI-ARIA keyboard pattern", async ({ browser, isolatedAppServer }) => {
  const seeded = await seedMonth(isolatedAppServer);
  const { context, page } = await openCalendar(browser, seeded, { width: 1280 });
  const day = (label: string) => page.getByRole("button", { name: label });

  await expect(page.locator("button[data-day][tabindex='0']")).toHaveCount(1);

  await day("Tuesday, November 17, 2026, 3 sent").focus();
  await page.keyboard.press("ArrowRight");
  await expect(day("Wednesday, November 18, 2026, nothing")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(day("Wednesday, November 25, 2026, nothing")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await expect(day("Tuesday, November 17, 2026, 3 sent")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(day("Monday, November 16, 2026, 1 sent")).toBeFocused();
  await page.keyboard.press("End");
  await expect(day("Sunday, November 22, 2026, nothing")).toBeFocused();

  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("complementary", { name: "Day panel" })
      .getByRole("heading", { name: "Mon, Nov 16" }),
  ).toBeVisible();
  await expect(day("Monday, November 16, 2026, 1 sent")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("PageDown");
  await expect(page.locator("#calendar-month")).toContainText("December 2026");
  await expect(page).toHaveURL(/month=2026-12/u);
  await expect(day("Wednesday, December 16, 2026, nothing")).toBeFocused();
  await page.keyboard.press("PageUp");
  await expect(page.locator("#calendar-month")).toContainText("November 2026");
  await expect(day("Monday, November 16, 2026, 1 sent")).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#calendar-month")).toContainText("October 2026");

  await context.close();
  await seeded.owner.dispose();
});

test("month buttons, Today and an empty month work, and the empty month says so", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);
  const { context, page } = await openCalendar(browser, seeded, { width: 1280 });

  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.locator("#calendar-month")).toContainText("December 2026");
  await expect(
    page.getByText("Nothing yet. Applications you send and replies from employers appear here."),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Day panel" }).getByText("Nothing on this day."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.locator("#calendar-month")).toContainText("November 2026");
  await expect(page.getByText("Nothing yet.")).toHaveCount(0);

  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.locator("#calendar-month")).toContainText(String(new Date().getUTCFullYear()));

  await context.close();
  await seeded.owner.dispose();
});

test("a Stage move shows on the open Calendar without a reload", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);
  const { context, page } = await openCalendar(browser, seeded, { width: 1280 });
  const before = page.getByRole("button", { name: "Tuesday, November 17, 2026, 3 sent" });

  await expect(before).toBeVisible();
  await moveClockTo(seeded.owner, Date.UTC(2026, 10, 17, 12));

  const moved = await seeded.owner.patch(
    `/api/applications/${encodeURIComponent(seeded.applicationIds[0] ?? "")}/stage`,
    { data: { position: null, stage: "interviewing" } },
  );

  expect(moved.ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Tuesday, November 17, 2026, 3 sent, 1 stage move" }),
  ).toBeVisible();

  await context.close();
  await seeded.owner.dispose();
});

test("Calendar is not a top-level item and Home opens it at /applications?view=calendar", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);
  const side = await openCalendar(browser, seeded, { path: "/home", width: 1280 });
  const nav = side.page.getByRole("navigation", { name: "Main" });

  await expect(nav.getByRole("link")).toHaveText([
    /^Home/u,
    /^Ready/u,
    /^Review/u,
    /^Applications/u,
    /^Inbox/u,
    /^Resume & Cover Letter/u,
    /^Job Preferences/u,
    /^Application Answers/u,
    /^Notifications/u,
    /^Support/u,
  ]);
  await expect(nav.getByRole("link", { name: "Calendar" })).toHaveCount(0);
  await side.context.close();

  const home = await openCalendar(browser, seeded, { path: "/home", width: 1280 });

  await home.page.getByRole("main").getByRole("link", { name: "Open Calendar" }).click();
  await expect(home.page).toHaveURL(/\/applications\?view=calendar(?:&month=\d{4}-\d{2})?$/u);
  await expect(home.page.getByRole("heading", { level: 1, name: "Job Calendar" })).toBeVisible();
  await home.context.close();

  const phone = await openCalendar(browser, seeded, { path: "/home", width: 390 });
  const tabs = phone.page.getByRole("navigation", { name: "Primary" });

  await expect(tabs.getByRole("link")).toHaveCount(5);
  await phone.page.getByRole("main").getByRole("link", { name: "Open Calendar" }).click();
  await expect(phone.page).toHaveURL(/\/applications\?view=calendar(?:&month=\d{4}-\d{2})?$/u);
  await phone.context.close();
  await seeded.owner.dispose();
});

test("the Calendar opens on today in the saved zone when the browser is in another zone", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);

  const { context, page } = await openCalendar(browser, seeded, {
    beforeGoto: async (target) => {
      await target.clock.setFixedTime(new Date("2026-11-18T02:30:00Z"));
    },
    timezoneId: "America/Los_Angeles",
    width: 1280,
  });

  await expect(
    page.getByRole("button", { name: /^Tuesday, November 17, 2026, 3 sent/u }),
  ).toBeVisible();
  await expect(page.locator('button[data-day="2026-11-18"]')).toHaveAttribute(
    "aria-current",
    "date",
  );
  await expect(page.locator('button[data-day="2026-11-18"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("complementary", { name: "Day panel" }).getByRole("heading", { level: 2 }),
  ).toContainText("Wed");

  await context.close();
  await seeded.owner.dispose();
});

test("on the phone the grid and inline day panel show each day's items", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);
  const { context, page } = await openCalendar(browser, seeded, { width: 390 });

  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Tuesday, November 17, 2026, 3 sent" }).click();

  const panel = page.getByRole("complementary", { name: "Day panel" });

  await expect(panel.getByRole("heading", { name: "Tue, Nov 17" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "View in Applications" })).toHaveCount(3);
  await expect(panel).toContainText("Halden Systems");
  await expect(panel).toContainText("Northwind Labs");
  await expect(panel).toContainText("Ferro Cloud");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Monday, November 16, 2026, 1 sent" }).click();
  await expect(panel.getByRole("heading", { name: "Mon, Nov 16" })).toBeVisible();
  await expect(panel).toContainText("Quill Works");

  await context.close();
  await seeded.owner.dispose();
});

for (const dark of [false, true]) {
  const theme = dark ? "dark" : "light";

  test(`the phone Calendar passes axe and fits the screen in ${theme}`, async ({
    browser,
    isolatedAppServer,
  }) => {
    const seeded = await seedMonth(isolatedAppServer);
    const { context, page } = await openCalendar(browser, seeded, { dark, width: 390 });

    await expect(page.getByRole("grid")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      fullPage: true,
      path: join(process.cwd(), `test/e2e/.tmp/calendar-phone-390-${theme}.png`),
    });

    await context.close();
    await seeded.owner.dispose();
  });
}

test("on the phone an empty month and an empty day say so", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);

  const { context, page } = await openCalendar(browser, seeded, {
    path: "/calendar?month=2026-12",
    width: 390,
  });

  await expect(
    page.getByText("Nothing yet. Applications you send and replies from employers appear here."),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.locator('button[data-day="2026-12-01"]').click();

  const panel = page.getByRole("complementary", { name: "Day panel" });

  await expect(panel.getByRole("heading", { level: 2 })).toContainText("Tue, Dec 1");
  await expect(panel.getByText("Nothing on this day.")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await context.close();
  await seeded.owner.dispose();
});

test("the Calendar shows its busy state while a month loads and keeps the old grid", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);
  let holding = false;
  const gate = Promise.withResolvers<true>();

  const { context, page } = await openCalendar(browser, seeded, {
    beforeGoto: async (target) => {
      await target.route(/\/api\/calendar\?/u, async (route) => {
        if (holding) {
          await gate.promise;
        }

        await route.continue();
      });
    },
    width: 1280,
  });

  const section = page.locator("section[aria-labelledby='calendar-month']");

  await expect(section).toHaveAttribute("aria-busy", "false");
  holding = true;
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(section).toHaveAttribute("aria-busy", "true");
  gate.resolve(true);
  await expect(page.locator("#calendar-month")).toContainText("December 2026");
  await expect(section).toHaveAttribute("aria-busy", "false");

  await context.close();
  await seeded.owner.dispose();
});

test("when the Calendar does not load it says so, and Try again loads it", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);
  let failing = true;

  const { context, page } = await openCalendar(browser, seeded, {
    beforeGoto: async (target) => {
      await target.route(/\/api\/calendar\?/u, async (route) => {
        if (failing) {
          await route.fulfill({ status: 500 });

          return;
        }

        await route.continue();
      });
    },
    width: 390,
  });

  await expect(page.getByRole("heading", { name: "The Calendar did not load." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Your Applications are safe. Try again in a moment.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  failing = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#calendar-month")).toContainText("November 2026");
  await expect(
    page.getByRole("button", { name: "Tuesday, November 17, 2026, 3 sent" }),
  ).toBeVisible();

  await context.close();
  await seeded.owner.dispose();
});

for (const width of [390, 768, 1280, 1920, 2560]) {
  for (const theme of ["light", "dark"] as const) {
    test(`the Calendar has no axe violations and no sway at ${String(width)} px, ${theme}`, async ({
      browser,
      isolatedAppServer,
    }) => {
      const seeded = await seedMonth(isolatedAppServer);

      const { context, page } = await openCalendar(browser, seeded, {
        dark: theme === "dark",
        width,
      });

      await page.getByRole("button", { name: "Tuesday, November 17, 2026, 3 sent" }).click();
      await expect(page.getByRole("heading", { name: "Tue, Nov 17", level: 2 })).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations, `${String(width)} ${theme}`).toEqual([]);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        fullPage: true,
        path: join(process.cwd(), `test/e2e/.tmp/calendar-${String(width)}-${theme}.png`),
      });

      await context.close();
      await seeded.owner.dispose();
    });
  }
}

for (const width of [390, 1280]) {
  for (const dark of [false, true]) {
    const theme = dark ? "dark" : "light";

    test(`an empty Calendar passes axe at ${String(width)} px, ${theme}`, async ({
      browser,
      isolatedAppServer,
    }) => {
      const { owner } = await ownerContextFor(isolatedAppServer.url);
      const seeded = { applicationIds: [], owner, server: isolatedAppServer };
      const { context, page } = await openCalendar(browser, seeded, { dark, width });

      await expect(page.getByText("Nothing yet.")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        fullPage: true,
        path: join(process.cwd(), `test/e2e/.tmp/calendar-empty-${String(width)}-${theme}.png`),
      });
      await context.close();
      await owner.dispose();
    });
  }
}

test("the Calendar needs a session", async ({ browser, isolatedAppServer }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${isolatedAppServer.url}/calendar`);
  await expect(page).toHaveURL(/\/signin/u);
  await context.close();
});

test("custom calendar events persist through /api/calendar/events across reloads", async ({
  browser,
  isolatedAppServer,
}) => {
  const seeded = await seedMonth(isolatedAppServer);
  const { context, page } = await openCalendar(browser, seeded, { width: 1280 });

  await page.getByRole("button", { name: "Tuesday, November 17, 2026, 3 sent" }).click();

  const panel = page.getByRole("complementary", { name: "Day panel" });

  await panel.getByRole("button", { name: "Add event" }).click();
  await panel.getByLabel("Event title").fill("System design interview");
  await panel.getByLabel("Company").fill("Stripe");
  await panel.getByRole("button", { name: "Save event" }).click();

  await expect(panel.getByText("System design interview")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.locator('button[data-day="2026-11-17"]').click();
  await expect(panel.getByText("System design interview")).toBeVisible();

  await panel.getByRole("button", { name: "Remove event" }).click();
  await expect(panel.getByText("System design interview")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.locator('button[data-day="2026-11-17"]').click();
  await expect(panel.getByText("System design interview")).toHaveCount(0);

  await context.close();
  await seeded.owner.dispose();
});
