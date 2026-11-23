import { z } from "zod";
import type { AppServer } from "./app-server.ts";
import type { Browser, BrowserContext, Page } from "@playwright/test";

import { AxeBuilder } from "@axe-core/playwright";
import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { ownerContextFor } from "./matching-harness.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const HANDOFF_ADMIN_ORIGIN = "https://admin.example.test";
const DEMO_EMAIL = "test@email.com";
const REGULAR_EMAIL = "regular.ownerless@example.com";

const meSchema = z.object({
  adminOrigin: z.string().nullable(),
  user: z.object({ role: z.string() }).nullable(),
});

const authStateSchema = z.object({
  users: z.array(z.object({ email: z.string(), id: z.string(), role: z.string() })),
});

const test = appTest.extend<{ demoServer: AppServer; handoffServer: AppServer }>({
  demoServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, { DEMO_LOGIN_ENABLED: "true" });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
  handoffServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        ADMIN_ORIGIN: HANDOFF_ADMIN_ORIGIN,
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function meOf(page: Page, url: string) {
  return meSchema.parse(await (await page.request.get(`${url}/api/me`)).json());
}

async function signInWithMagicLink(page: Page, url: string, email: string) {
  await requestMagicLink(url, page.request, email);

  await page.goto(await latestMailLink(url, page.request, email));
}

async function signInAsOwner(page: Page, url: string) {
  await signInWithMagicLink(page, url, authTestIdentity.ownerEmail);

  return page.request.storageState();
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(overflow.scroll, `horizontal overflow at ${label}`).toBeLessThanOrEqual(overflow.client);
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `axe violations at ${label}`).toEqual([]);
}

async function expectRegionAxeClean(page: Page, selector: string, label: string) {
  const results = await new AxeBuilder({ page }).include(selector).analyze();

  expect(results.violations, `axe violations at ${label}`).toEqual([]);
}

async function openHandoffAt(
  browser: Browser,
  state: Awaited<ReturnType<BrowserContext["storageState"]>>,
  theme: "light" | "dark",
  width: number,
) {
  const context = await browser.newContext({
    storageState: state,
    viewport: { height: 844, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  return { context, page };
}

interface HandoffViewport {
  theme: "light" | "dark";
  width: number;
}

async function checkHandoffViewports(
  browser: Browser,
  state: Awaited<ReturnType<BrowserContext["storageState"]>>,
  handoffUrl: string,
  remaining: readonly HandoffViewport[],
) {
  const [next, ...rest] = remaining;

  if (next === undefined) {
    return;
  }

  const opened = await openHandoffAt(browser, state, next.theme, next.width);
  const label = `${String(next.width)}px ${next.theme}`;

  try {
    await opened.page.goto(`${handoffUrl}/admin`);

    await expect(
      opened.page.getByRole("heading", { name: "The admin opens on its own host" }),
    ).toBeVisible();
    await expect(opened.page.getByRole("link", { name: /Open Admin Portal/u })).toHaveAttribute(
      "href",
      `${HANDOFF_ADMIN_ORIGIN}/admin`,
    );

    await expectNoHorizontalOverflow(opened.page, label);
    await expectAxeClean(opened.page, label);
  } finally {
    await opened.context.close();
  }

  await checkHandoffViewports(browser, state, handoffUrl, rest);
}

test("the owner sees the Admin Portal link in the Profile menu and on the account page", async ({
  appServerUrl,
  ownerPage: page,
}) => {
  await page.goto(`${appServerUrl}/profile/account`);

  const accountLink = page.getByRole("link", { name: /Open Admin Portal/u });

  await expect(accountLink).toBeVisible();
  await expect(accountLink).toHaveAttribute("href", "https://admin.tryoverture.com/admin");

  await page.getByRole("link", { name: "Profile", exact: true }).first().hover();

  const menuItem = page.getByRole("menuitem", { name: /Admin Portal/u });

  await expect(menuItem).toBeVisible();
  await expect(menuItem).toHaveAttribute("href", "https://admin.tryoverture.com/admin");

  const me = await meOf(page, appServerUrl);

  expect(me.user?.role).toBe("owner");
  expect(me.adminOrigin).toBe("https://admin.tryoverture.com");
});

test("the owner's account card is axe clean and overflow-free at phone and desktop widths", async ({
  appServerUrl,
  ownerPage: page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(`${appServerUrl}/profile/account`);
  await expect(page.getByRole("link", { name: /Open Admin Portal/u })).toBeVisible();

  await expectRegionAxeClean(page, "#admin-portal", "account card at 390px");
  await expectNoHorizontalOverflow(page, "account card at 390px");

  await page.setViewportSize({ height: 844, width: 1280 });
  await page.goto(`${appServerUrl}/profile/account`);
  await expect(page.getByRole("link", { name: /Open Admin Portal/u })).toBeVisible();

  await expectRegionAxeClean(page, "#admin-portal", "account card at 1280px");
  await expectNoHorizontalOverflow(page, "account card at 1280px");
});

test("a regular user never sees the Admin Portal link", async ({ appServerUrl, page }) => {
  const { owner } = await ownerContextFor(appServerUrl);

  await owner.post("/__test__/users", { data: { email: REGULAR_EMAIL, name: "Regular User" } });
  await owner.dispose();

  await signInWithMagicLink(page, appServerUrl, REGULAR_EMAIL);

  const me = await meOf(page, appServerUrl);

  const state = authStateSchema.parse(
    await (await page.request.get(`${appServerUrl}/__test__/auth/state`)).json(),
  );

  const role = state.users.find((user) => user.email === REGULAR_EMAIL)?.role;

  expect(role).toBe("user");
  expect(me.user?.role).toBe("user");
  expect(me.adminOrigin).toBeNull();

  await page.goto(`${appServerUrl}/profile/account`);
  await expect(page.getByRole("heading", { name: "Account", exact: false }).first()).toBeVisible();

  await expect(page.getByText("Admin Portal", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Profile", exact: true }).first().hover();

  await expect(page.getByRole("menuitem", { name: /Admin Portal/u })).toHaveCount(0);
});

test("the demo account never sees the Admin Portal link", async ({ browser, demoServer }) => {
  const page = await browser.newPage();

  await page.goto(`${demoServer.url}/signin`);
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();

  const me = await meOf(page, demoServer.url);

  expect(me.user?.role).toBe("demo");
  expect(me.adminOrigin).toBeNull();

  await page.goto(`${demoServer.url}/profile/account`);
  await expect(page.getByRole("heading", { name: "Account", exact: false }).first()).toBeVisible();

  await expect(page.getByText("Admin Portal", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Admin Portal/u })).toHaveCount(0);

  await page.context().close();
});

test("an anonymous visitor on the main host keeps the admin gate, not the handoff", async ({
  page,
  handoffServer,
}) => {
  await page.goto(`${handoffServer.url}/admin`);

  await expect(page.getByRole("heading", { name: "The admin opens on its own host" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "Not through the gate" })).toBeVisible();
});

test("an owner on the main host gets a handoff card that opens the admin host", async ({
  browser,
  handoffServer,
}) => {
  const page = await browser.newPage();

  const state = await signInAsOwner(page, handoffServer.url);

  await page.goto(`${handoffServer.url}/admin/users/unknown-user?status=active`);

  await expect(
    page.getByRole("heading", { name: "The admin opens on its own host" }),
  ).toBeVisible();

  const open = page.getByRole("link", { name: /Open Admin Portal/u });

  await expect(open).toHaveAttribute(
    "href",
    `${HANDOFF_ADMIN_ORIGIN}/admin/users/unknown-user?status=active`,
  );
  await expect(page.getByRole("navigation", { name: "Admin sections" })).toHaveCount(0);
  await expect(page.getByText(/admin\.example\.test/u).first()).toBeVisible();

  await page.context().close();

  await checkHandoffViewports(browser, state, handoffServer.url, [
    { theme: "light", width: 390 },
    { theme: "dark", width: 390 },
    { theme: "light", width: 1280 },
    { theme: "dark", width: 1280 },
  ]);
});
