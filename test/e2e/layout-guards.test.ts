import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { test, expect } from "./admin.fixture.ts";

const widths = [390, 768, 1280, 1440, 1920, 2560] as const;
const themes = ["light", "dark"] as const;

const routeSource = readFileSync(join(process.cwd(), "src/web/route-table.tsx"), "utf8");

const routerPaths = [...routeSource.matchAll(/path: "(?<path>[^"]+)"/gu)].map(
  (match) => match.groups?.path ?? "",
);

type Storage = "app" | "admin" | "anonymous";

interface Target {
  path: string;
  url: string;
  storage: Storage;
}

function storageFor(path: string) {
  if (path.startsWith("/admin")) {
    return "admin" as const;
  }

  if (
    path === "/signin" ||
    path === "/terms" ||
    path === "/privacy" ||
    path === "/pricing" ||
    path === "/consent"
  ) {
    return "anonymous" as const;
  }

  return "app" as const;
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
  "/",
  "/ready",
  "/board",
  "/review",
  "/inbox",
  "/notifications",
  "/profile",
  "/search",
  "/settings",
  "*",
]);

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
    // The Settings row sits above the nav's end; the avatar at the bottom is the last match.
    const settingsLinks = element.querySelectorAll('a[href="/settings"]');
    const bottomLink = settingsLinks.item(settingsLinks.length - 1);

    return {
      bottomLinkBottom: bottomLink === null ? null : bottomLink.getBoundingClientRect().bottom,
      position: getComputedStyle(element).position,
      top: box.top,
      width: box.width,
    };
  });

  expect(metrics.top, `${path} aside top after scroll`).toBe(0);
  expect(["fixed", "sticky"], `${path} aside position`).toContain(metrics.position);

  if (width < 1280 || path === "/board") {
    expect(metrics.width, `${path} rail width`).toBe(76);
  } else if (width >= 1700) {
    expect(metrics.width, `${path} sidebar width`).toBe(300);
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

// Legacy settings paths that redirect; the sweep checks the page they land on.
const redirectedPaths: Record<string, string> = {
  "/settings/notifications": "/settings",
  "/settings/support": "/settings",
  "/settings/terms": "/terms",
};

async function checkTarget(page: Page, target: Target, url: string, width: number) {
  const requestedPath = new URL(url).pathname;
  const expectedPath = redirectedPaths[requestedPath] ?? requestedPath;

  await navigate(page, requestedPath, expectedPath);
  await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL((current) => current.pathname === expectedPath);
  await page.evaluate(async () => {
    globalThis.scrollTo(0, 0);
    await document.fonts.ready;
  });

  await expectNoOverflow(page, target.path);

  if (shellPaths.has(target.path) && width >= 768) {
    await expectSidebarFixed(page, target.path, width);
  }
}

async function runTargets(
  remaining: Target[],
  pageFor: (storage: Storage) => Promise<Page>,
  urlOf: (target: Target) => string,
  width: number,
) {
  if (remaining.length === 0) {
    return;
  }

  const [target, ...rest] = remaining;

  if (target === undefined) {
    return;
  }

  const page = await pageFor(target.storage);

  await checkTarget(page, target, urlOf(target), width);
  await runTargets(rest, pageFor, urlOf, width);
}

async function openContext(
  browser: Browser,
  storage: Storage,
  width: number,
  theme: string,
  storageStates: {
    admin: Awaited<ReturnType<BrowserContext["storageState"]>>;
    app: Awaited<ReturnType<BrowserContext["storageState"]>>;
  },
) {
  const viewport = { height: 900, width };

  const context =
    storage === "anonymous"
      ? await browser.newContext({ viewport })
      : await browser.newContext({
          storageState: storage === "app" ? storageStates.app : storageStates.admin,
          viewport,
        });

  if (theme === "dark") {
    await context.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  return context;
}

test.describe.configure({ timeout: 120_000 });

for (const width of widths) {
  for (const theme of themes) {
    test(`G1/G4/G5 every route at ${String(width)} ${theme}`, async ({
      adminAppUrl,
      appServerUrl,
      browser,
      chromeOwnerStorage,
      ownerAccessCookieState,
    }) => {
      const contexts = {
        admin: await openContext(browser, "admin", width, theme, {
          admin: ownerAccessCookieState,
          app: chromeOwnerStorage,
        }),
        anonymous: await openContext(browser, "anonymous", width, theme, {
          admin: ownerAccessCookieState,
          app: chromeOwnerStorage,
        }),
        app: await openContext(browser, "app", width, theme, {
          admin: ownerAccessCookieState,
          app: chromeOwnerStorage,
        }),
      };

      const urls: Record<Storage, string> = {
        admin: adminAppUrl,
        anonymous: appServerUrl,
        app: appServerUrl,
      };

      const pages = new Map<Storage, Page>();

      const startPaths: Record<Storage, string> = {
        admin: "/admin",
        anonymous: "/signin",
        app: "/",
      };

      const pageFor = async (storage: Storage) => {
        const open = pages.get(storage);

        if (open !== undefined) {
          return open;
        }

        const page = await contexts[storage].newPage();

        await page.goto(`${urls[storage]}${startPaths[storage]}`);
        await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });
        pages.set(storage, page);

        return page;
      };

      try {
        await runTargets(
          targets,
          pageFor,
          (target) => `${urls[target.storage]}${target.url}`,
          width,
        );
      } finally {
        await Promise.all(Object.values(contexts).map(async (context) => context.close()));
      }
    });
  }
}
