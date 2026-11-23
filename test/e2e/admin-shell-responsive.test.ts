import { enableVirtualAuthenticator, signInOwnerOnAdmin } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";

import { AxeBuilder } from "@axe-core/playwright";

import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const widths = [390, 768, 1024, 1280] as const;
const themes = ["light", "dark"] as const;

const destinations = [
  { name: "Overview", url: /\/admin$/u },
  { name: "Attempts", url: /\/admin\/attempts$/u },
  { name: "LLM spend", url: /\/admin\/llm$/u },
  { name: "Users", url: /\/admin\/users$/u },
  { name: "Invites", url: /\/admin\/invites$/u },
  { name: "Grants", url: /\/admin\/grants$/u },
  { name: "Kill switches & settings", url: /\/admin\/settings$/u },
  { name: "Catalog health", url: /\/admin\/catalog$/u },
  { name: "Mail health", url: /\/admin\/mail-health$/u },
] as const;

const canvasLeak = /\bFig\b|\bFolio\b|§/u;

function adminNav(page: Page) {
  return page.getByRole("navigation", { name: "Admin sections" }).filter({ visible: true });
}

function destinationLink(nav: Locator, name: string) {
  return nav.getByRole("link", { name, exact: true });
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(overflow.scroll, `horizontal overflow at ${label}`).toBeLessThanOrEqual(overflow.client);
}

async function expectNoCanvasLeak(page: Page, label: string) {
  const text = await page.locator("main").textContent();

  expect(text, `canvas annotation leaked at ${label}`).not.toMatch(canvasLeak);
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `axe violations at ${label}`).toEqual([]);
}

async function signInAsOwner(
  page: Page,
  adminIsolatedAppUrl: string,
  issueToken: (claims: { email: string }) => Promise<string>,
) {
  await enableVirtualAuthenticator(page);
  await signInOwnerOnAdmin(page, adminIsolatedAppUrl);

  const token = await issueToken({ email: authTestIdentity.ownerEmail });

  const cookie = {
    name: "CF_Authorization",
    value: token,
    domain: "localhost",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: false,
    sameSite: "Lax" as const,
  };

  await page.context().addCookies([cookie]);
  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await page.getByRole("button", { name: "Add your passkey" }).click();
  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();

  const state = await page.context().storageState();

  state.cookies.push(cookie);

  return state;
}

async function openAdminShell(
  browser: Browser,
  adminIsolatedAppUrl: string,
  state: StorageState,
  theme: (typeof themes)[number],
  width: (typeof widths)[number],
) {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();

  await page.addInitScript((stored) => {
    globalThis.localStorage.setItem("overture.theme", stored);
  }, theme);
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();

  return { context, page };
}

async function clickThrough(
  page: Page,
  label: string,
  remaining: readonly (typeof destinations)[number][],
) {
  const [next, ...rest] = remaining;

  if (next === undefined) {
    return;
  }

  await destinationLink(adminNav(page), next.name).click();
  await expect(page).toHaveURL(next.url);
  await expectNoHorizontalOverflow(page, `${next.name} at ${label}`);
  await expectNoCanvasLeak(page, `${next.name} at ${label}`);

  await clickThrough(page, label, rest);
}

test.describe("admin shell responsive layout", () => {
  test.setTimeout(180_000);

  for (const width of widths) {
    for (const theme of themes) {
      test(`every admin section is visible, overflow-free and axe clean at ${String(width)}px ${theme}`, async ({
        browser,
        page,
        adminIsolatedAppUrl,
        accessServer,
      }) => {
        const label = `${String(width)}px ${theme}`;

        const state = await signInAsOwner(page, adminIsolatedAppUrl, async (claims) =>
          accessServer.issueToken(claims),
        );

        const { context, page: shell } = await openAdminShell(
          browser,
          adminIsolatedAppUrl,
          state,
          theme,
          width,
        );

        const nav = adminNav(shell);

        await Promise.all(
          destinations.map(async (destination) =>
            expect(
              destinationLink(nav, destination.name),
              `${destination.name} visible at ${label}`,
            ).toBeVisible(),
          ),
        );

        if (width === 390) {
          const heights = await Promise.all(
            destinations.map(async (destination) => ({
              height:
                (await destinationLink(nav, destination.name).locator("span").first().boundingBox())
                  ?.height ?? 0,
              name: destination.name,
            })),
          );

          for (const { height, name } of heights) {
            expect(height, `${name} touch target at ${label}`).toBeGreaterThanOrEqual(44);
          }
        }

        await expectNoHorizontalOverflow(shell, label);
        await expectAxeClean(shell, label);

        await context.close();
      });
    }
  }

  for (const width of [390, 768] as const) {
    test(`clicking through every admin section works at ${String(width)}px`, async ({
      browser,
      page,
      adminIsolatedAppUrl,
      accessServer,
    }) => {
      const label = `${String(width)}px light`;

      const state = await signInAsOwner(page, adminIsolatedAppUrl, async (claims) =>
        accessServer.issueToken(claims),
      );

      const { context, page: shell } = await openAdminShell(
        browser,
        adminIsolatedAppUrl,
        state,
        "light",
        width,
      );

      await clickThrough(shell, label, destinations);

      await context.close();
    });
  }
});
