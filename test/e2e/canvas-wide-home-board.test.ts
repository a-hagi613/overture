import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { openBoard, seedBoard, seedBoardOwner } from "./board-harness.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const serverNow = Date.UTC(2026, 10, 17, 11, 15, 0);
const okSchema = z.object({ ok: z.boolean() });

const test = appTest.extend<{ wideServer: AppServer }>({
  wideServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function moveClockTo(request: APIRequestContext, target: number) {
  const current = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  const moved = await request.post("/__test__/clock/offset", {
    data: { offsetMs: target - current.now },
  });

  expect(moved.ok()).toBe(true);
}

async function signIn(request: APIRequestContext, appServerUrl: string) {
  await moveClockTo(request, serverNow);
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);
  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);
  await request.get(link);
  await request.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
}

async function expectNoSidewaysSway(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
    doc: document.documentElement.scrollWidth,
    scrollX: globalThis.scrollX,
  }));

  expect(overflow.doc, `${label} document width`).toBeLessThanOrEqual(overflow.client);
  expect(overflow.body, `${label} body width`).toBeLessThanOrEqual(overflow.client);
  expect(overflow.scrollX, `${label} sideways sway`).toBe(0);
}

function rgbOf(hex: string) {
  const value = hex.replace("#", "");

  return `rgb(${[
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ].join(", ")})`;
}

for (const width of [1440, 1920, 2560]) {
  test(`the Home page keeps the canvas wide frame at ${String(width)}px`, async ({
    browser,
    wideServer,
  }) => {
    const wide = width >= 1700;
    const request = await apiRequest.newContext({ baseURL: wideServer.url });

    await signIn(request, wideServer.url);

    const seeded = await request.post("/__test__/home/sample", {
      data: { email: authTestIdentity.ownerEmail },
    });

    okSchema.parse(await seeded.json());

    const storageState = await request.storageState();

    await request.dispose();

    const context = await browser.newContext({
      deviceScaleFactor: 1,
      storageState,
      timezoneId: "America/Toronto",
      viewport: { height: 1000, width },
    });

    const page = await context.newPage();

    await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));
    await page.goto(`${wideServer.url}/`);

    await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();
    await expect(page.locator(".home-kpis article .font-serif").first()).toBeVisible();

    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const metrics = await page.evaluate(() => {
      const numeral = document.querySelector(".home-kpis article .font-serif");
      const plot = document.querySelector(".home-chart-frame");
      const main = document.querySelector("[data-shell-main]");
      const kpis = document.querySelector(".home-kpis");

      const numeralStyle = numeral === null ? null : getComputedStyle(numeral);
      const mainStyle = main === null ? null : getComputedStyle(main);
      const kpisStyle = kpis === null ? null : getComputedStyle(kpis);

      return {
        gap: kpisStyle === null ? "" : kpisStyle.columnGap,
        numeral: numeralStyle === null ? "" : numeralStyle.fontSize,
        paddingBottom: mainStyle === null ? "" : mainStyle.paddingBottom,
        paddingLeft: mainStyle === null ? "" : mainStyle.paddingLeft,
        paddingTop: mainStyle === null ? "" : mainStyle.paddingTop,
        plotHeight: plot === null ? 0 : Math.round(plot.getBoundingClientRect().height),
      };
    });

    expect(metrics.numeral, `${String(width)}px KPI numeral`).toBe(wide ? "66px" : "56px");
    expect(metrics.gap, `${String(width)}px KPI gap`).toBe(wide ? "24px" : "16px");
    expect(metrics.paddingLeft, `${String(width)}px main padding-left`).toBe(
      wide ? "64px" : "36px",
    );
    expect(metrics.paddingTop, `${String(width)}px main padding-top`).toBe(wide ? "32px" : "26px");
    expect(metrics.paddingBottom, `${String(width)}px main padding-bottom`).toBe(
      wide ? "52px" : "40px",
    );
    expect(metrics.plotHeight, `${String(width)}px chart plot`).toBe(wide ? 270 : 200);

    await expectNoSidewaysSway(page, `${String(width)}px Home`);

    const counters = await page.evaluate(() => {
      const text = document.body.textContent.toLowerCase();
      const count = (needle: string) => text.split(needle).length - 1;

      return { applicationsLeft: count("applications left"), matchScores: count("match scores") };
    });

    expect(counters.applicationsLeft, `${String(width)}px Applications left`).toBe(1);
    expect(counters.matchScores, `${String(width)}px Match scores`).toBe(0);

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations, `${String(width)}px Home`).toEqual([]);

    await context.close();
  });
}

for (const width of [1440, 1920, 2560]) {
  test(`the Board keeps the canvas wide frame at ${String(width)}px`, async ({
    browser,
    wideServer,
  }) => {
    const wide = width >= 1700;
    const request = await apiRequest.newContext({ baseURL: wideServer.url });

    await signIn(request, wideServer.url);

    const userId = await seedBoardOwner(request, wideServer.url);
    const { selectedId } = await seedBoard(request, userId);

    const storageState = await request.storageState();

    await request.dispose();

    const context = await browser.newContext({
      storageState,
      timezoneId: "America/Toronto",
      viewport: { height: 1000, width },
    });

    const page = await context.newPage();

    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.rail", "1");
    });

    await page.clock.setFixedTime(new Date(2026, 10, 21, 12, 0, 0));
    await openBoard(page, wideServer.url, width, selectedId);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const columns = await page.evaluate(() => {
      const stages = [...document.querySelectorAll(".cols [data-stage]")];

      return stages.map((stage) => Math.round(stage.getBoundingClientRect().width));
    });

    const sheetWidth = await page
      .getByRole("complementary", { name: "Application detail" })
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));

    expect(columns.length, `${String(width)}px stages`).toBe(7);
    expect(sheetWidth, `${String(width)}px application sheet`).toBe(wide ? 520 : 468);

    const narrowest = Math.min(...columns);
    const widest = Math.max(...columns);

    expect(narrowest, `${String(width)}px narrowest column`).toBeGreaterThanOrEqual(252);
    expect(widest, `${String(width)}px widest column`).toBeLessThanOrEqual(340);

    if (width === 2560) {
      expect(widest, `${String(width)}px columns fill the frame`).toBeGreaterThan(252);
    } else {
      expect(widest, `${String(width)}px columns hold 252`).toBe(252);
    }

    await expectNoSidewaysSway(page, `${String(width)}px Board`);

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations, `${String(width)}px Board`).toEqual([]);

    if (width === 1440) {
      const marks = await page.evaluate(() => {
        const root = document.querySelector(".board");
        const style = root === null ? null : getComputedStyle(root);

        const readToken = (name: string) =>
          style === null ? "" : style.getPropertyValue(name).trim();

        const queuedHeader = document.querySelector('.cols [data-stage="queued"] > div');
        const readyHeader = document.querySelector('.cols [data-stage="ready"] > div');
        const pill = document.querySelector(".cols .oc-rej");
        const pillStyle = pill === null ? null : getComputedStyle(pill);

        return {
          headings: [...document.querySelectorAll("h1, h2")].map((element) => element.textContent),
          ink: readToken("--color-foreground"),
          need: readToken("--color-need"),
          needBackground: readToken("--color-need-soft"),
          ok: readToken("--color-ok"),
          pillBackground: pillStyle === null ? "" : pillStyle.backgroundColor,
          pillColour: pillStyle === null ? "" : pillStyle.color,
          pillText: pill === null ? "" : pill.textContent,
          queuedRule: queuedHeader === null ? "" : getComputedStyle(queuedHeader).borderTopColor,
          readyRule: readyHeader === null ? "" : getComputedStyle(readyHeader).borderTopColor,
        };
      });

      expect(marks.headings.some((heading) => heading.includes("Job Board"))).toBe(false);
      expect(marks.headings.some((heading) => heading.includes("Board"))).toBe(true);

      expect(marks.queuedRule).toBe(rgbOf(marks.ink));
      expect(marks.readyRule).toBe(rgbOf(marks.ok));

      expect(marks.pillText).toBe("Needs you");
      expect(marks.pillColour).toBe(rgbOf(marks.need));
      expect(marks.pillBackground).toBe(rgbOf(marks.needBackground));
    }

    await context.close();
  });
}
