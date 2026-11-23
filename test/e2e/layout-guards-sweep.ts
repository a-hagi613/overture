import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./admin.fixture.ts";

export const widths = [390, 768, 1280, 1440, 1920, 2560] as const;
export const themes = ["light", "dark"] as const;

export type Theme = (typeof themes)[number];

export type Storage = "app" | "admin" | "anonymous";

const routeSource = readFileSync(join(process.cwd(), "src/web/route-table.tsx"), "utf8");

const routerPaths = [...routeSource.matchAll(/path: "(?<path>[^"]+)"/gu)].map(
  (match) => match.groups?.path ?? "",
);

interface Target {
  path: string;
  url: string;
  storage: Storage;
}

function storageFor(path: string) {
  if (path.startsWith("/admin")) {
    return "admin";
  }

  if (
    path === "/" ||
    path === "/pricing" ||
    path === "/signin" ||
    path === "/signup" ||
    path === "/terms" ||
    path === "/privacy" ||
    path === "/consent"
  ) {
    return "anonymous";
  }

  return "app";
}

function urlFor(path: string) {
  if (path === "*") {
    return "/__missing__";
  }

  return path.replace(":id", "unknown-user");
}

const targets: Target[] = routerPaths.map((path) => ({
  path,
  storage: storageFor(path),
  url: urlFor(path),
}));

const shellPaths = new Set([
  "/home",
  "/ready",
  "/board",
  "/review",
  "/calendar",
  "/inbox",
  "/inbox/:id",
  "/notifications",
  "/profile",
  "/profile/resume",
  "/profile/details",
  "/profile/preferences",
  "/profile/account",
  "/profile/billing",
  "/support",
  "*",
]);

const redirectedPaths = new Map(
  [
    ...routeSource.matchAll(
      /path:\s*"(?<from>[^"]+)"[^}]*?<(?:Navigate replace|PreserveSearchRedirect)\s+to="(?<to>[^"#]+)/gu,
    ),
  ].map((match) => [match.groups?.from ?? "", match.groups?.to ?? ""]),
);

const FONT_SETTLE_TIMEOUT_MS = 5000;

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface SweepFixtures {
  adminAppUrl: string;
  appServerUrl: string;
  browser: Browser;
  chromeOwnerStorage: StorageState;
  ownerAccessCookieState: StorageState;
}

export function targetsFor(storage: Storage) {
  return targets.filter((target) => target.storage === storage);
}

async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const { clientWidth } = doc;
    const offenders: string[] = [];

    for (const element of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(element);

      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }

      const box = element.getBoundingClientRect();

      if (box.width === 0 && box.height === 0) {
        continue;
      }

      const region = element.closest("[data-scroll-region]");

      if (region === null && (box.right > clientWidth + 1 || box.left < -1)) {
        const cls = (element.getAttribute("class") ?? "").slice(0, 90);

        offenders.push(
          `${element.tagName.toLowerCase()} ${JSON.stringify(cls)} [${String(Math.round(box.left))}, ${String(Math.round(box.right))}]`,
        );
      }
    }

    globalThis.scrollTo(1000, 0);

    return {
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth,
      docScrollWidth: doc.scrollWidth,
      offenders: offenders.slice(0, 8),
      scrollX: globalThis.scrollX,
    };
  });
}

async function measureScrollers(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];

    for (const element of document.body.querySelectorAll("*")) {
      const tag = element.tagName.toLowerCase();

      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        tag === "html" ||
        tag === "body"
      ) {
        continue;
      }

      const style = getComputedStyle(element);

      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }

      const scrollsX = style.overflowX === "auto" || style.overflowX === "scroll";
      const scrollsY = style.overflowY === "auto" || style.overflowY === "scroll";

      if (!scrollsX && !scrollsY) {
        continue;
      }

      const overflows =
        (scrollsX && element.scrollWidth > element.clientWidth + 1) ||
        (scrollsY && element.scrollHeight > element.clientHeight + 1);

      if (!overflows || element.closest("[data-scroll-region]") !== null) {
        continue;
      }

      const cls = (element.getAttribute("class") ?? "").slice(0, 90);

      offenders.push(`${element.tagName.toLowerCase()} ${JSON.stringify(cls)}`);
    }

    return { offenders: offenders.slice(0, 8) };
  });
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await measureOverflow(page);

  expect(overflow.docScrollWidth, `${label} document width`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
  expect(overflow.bodyScrollWidth, `${label} body width`).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.scrollX, `${label} sideways sway`).toBe(0);
  expect(overflow.offenders, `${label} elements past the viewport`).toEqual([]);

  const scrollers = await measureScrollers(page);

  expect(scrollers.offenders, `${label} unmarked scrollers`).toEqual([]);
}

async function expectSidebarFixed(page: Page, path: string, width: number) {
  const aside = page.locator("[data-shell-sidebar]").first();

  await expect(aside, `${path} should render a sidebar at ${String(width)}`).toBeVisible({
    timeout: 10_000,
  });

  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportHeight = page.viewportSize()?.height ?? 900;

  if (height <= viewportHeight + 40) {
    return;
  }

  await page.evaluate(() => {
    globalThis.scrollTo(0, 400);
  });

  const metrics = await aside.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const bottomLinks = [...element.querySelectorAll('a[href="/notifications"]')];
    const bottomLink = bottomLinks.at(-1);

    return {
      bottomLinkBottom: bottomLink?.getBoundingClientRect().bottom ?? null,
      position: getComputedStyle(element).position,
      top: box.top,
      width: box.width,
    };
  });

  expect(metrics.top, `${path} aside top after scroll`).toBe(0);
  expect(["fixed", "sticky"], `${path} aside position`).toContain(metrics.position);

  if (width < 1280) {
    expect(metrics.width, `${path} rail width`).toBe(76);
  } else if (width >= 1700) {
    expect(metrics.width, `${path} sidebar width`).toBe(296);
  } else {
    expect(metrics.width, `${path} sidebar width`).toBe(268);
  }

  if (metrics.bottomLinkBottom !== null) {
    expect(metrics.bottomLinkBottom, `${path} bottom block in viewport`).toBeLessThanOrEqual(
      viewportHeight + 1,
    );
  }
}

async function navigate(page: Page, path: string, landsOn: string = path) {
  await page.evaluate(async (next) => {
    globalThis.history.pushState({}, "", next);
    globalThis.dispatchEvent(new PopStateEvent("popstate"));
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }, path);
  await page.waitForFunction((next) => globalThis.location.pathname === next, landsOn);
}

async function settleLayout(page: Page) {
  await page.evaluate(async (timeoutMs) => {
    globalThis.scrollTo(0, 0);

    await Promise.race([
      document.fonts.ready.then(() => undefined),
      new Promise((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }, FONT_SETTLE_TIMEOUT_MS);
}

async function checkTarget(page: Page, target: Target, url: string, width: number) {
  const requestedPath = new URL(url).pathname;
  const expectedPath = redirectedPaths.get(requestedPath) ?? requestedPath;

  await navigate(page, requestedPath, expectedPath);
  await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL((current) => current.pathname === expectedPath);
  await settleLayout(page);

  await expectNoOverflow(page, target.path);

  if (shellPaths.has(expectedPath) && width >= 768) {
    await expectSidebarFixed(page, expectedPath, width);
  }
}

async function openContext(fixtures: SweepFixtures, storage: Storage, width: number, theme: Theme) {
  const viewport = { height: 900, width };

  const context =
    storage === "anonymous"
      ? await fixtures.browser.newContext({ viewport })
      : await fixtures.browser.newContext({
          storageState:
            storage === "app" ? fixtures.chromeOwnerStorage : fixtures.ownerAccessCookieState,
          viewport,
        });

  if (theme === "dark") {
    await context.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  return context;
}

const urlsFor = (fixtures: SweepFixtures) => ({
  admin: fixtures.adminAppUrl,
  anonymous: fixtures.appServerUrl,
  app: fixtures.appServerUrl,
});

const startPaths: Record<Storage, string> = {
  admin: "/admin",
  anonymous: "/signin",
  app: "/home",
};

async function sweepTargets(
  page: Page,
  group: readonly Target[],
  urlOf: (target: Target) => string,
  width: number,
) {
  const [target, ...rest] = group;

  if (target === undefined) {
    return;
  }

  await test.step(target.path, async () => {
    await checkTarget(page, target, urlOf(target), width);
  });

  await sweepTargets(page, rest, urlOf, width);
}

/**
 * Walks every route that belongs to one storage group at one width and theme.
 *
 * Each group needs its own browser context (anonymous, a signed-in app session, an
 * owner admin session) and the three groups together used to fill one 120 s test, so
 * a single stalled route took the other groups' routes down with it and surfaced only
 * as a bare timeout.
 * @param storage Which context the routes are visited with.
 * @param width The viewport width to measure at.
 * @param theme The colour scheme the page is painted with.
 * @param fixtures The Playwright fixtures that provide the two app servers and sessions.
 * @returns Nothing; every assertion runs inside the test.
 */
export async function sweepStorageGroup(
  storage: Storage,
  width: number,
  theme: Theme,
  fixtures: SweepFixtures,
) {
  const group = targetsFor(storage);
  const context = await openContext(fixtures, storage, width, theme);
  const urls = urlsFor(fixtures);

  try {
    const page = await context.newPage();

    await page.goto(`${urls[storage]}${startPaths[storage]}`);
    await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });

    await sweepTargets(page, group, (target) => `${urls[storage]}${target.url}`, width);
  } finally {
    await context.close();
  }
}

/**
 * Registers the twelve width × theme tests for one storage group.
 * @param label The group's name in the test title.
 * @param storage Which context the routes are visited with.
 * @returns Nothing.
 */
export function defineLayoutGuardSpecs(label: string, storage: Storage) {
  test.describe.configure({ timeout: 120_000 });

  for (const width of widths) {
    for (const theme of themes) {
      test(`G1/G4/G5 ${label} routes at ${String(width)} ${theme}`, async ({
        adminAppUrl,
        appServerUrl,
        browser,
        chromeOwnerStorage,
        ownerAccessCookieState,
      }) => {
        await sweepStorageGroup(storage, width, theme, {
          adminAppUrl,
          appServerUrl,
          browser,
          chromeOwnerStorage,
          ownerAccessCookieState,
        });
      });
    }
  }
}
