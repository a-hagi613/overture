import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ badgeServer: AppServer }>({
  badgeServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const navCountsSchema = z.object({
  inboxUnread: z.number(),
  ready: z.number(),
  review: z.number(),
});

const homeCountsSchema = z.object({
  ready: z.object({ ready: z.number() }),
  reviews: z.object({ total: z.number() }),
});

async function freshUser(appServer: AppServer) {
  const request = await apiRequest.newContext({ baseURL: appServer.url });

  await requestMagicLink(appServer.url, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServer.url, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServer.url}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  return { request, storageState: await request.storageState() };
}

async function navCounts(request: Awaited<ReturnType<typeof apiRequest.newContext>>) {
  const response = await request.get("/api/nav");

  expect(response.ok()).toBe(true);

  return navCountsSchema.parse(await response.json());
}

async function openHome(page: Page, appServer: AppServer) {
  const navResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/nav") && response.ok(),
  );

  await page.goto(`${appServer.url}/`);

  await navResponse;
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();
}

const destinations = ["Ready", "Review", "Inbox"] as const;

test("a fresh user's shell shows no nav badges at 1280 and 390", async ({
  badgeServer,
  browser,
}) => {
  const { request, storageState } = await freshUser(badgeServer);

  expect(await navCounts(request)).toEqual({ inboxUnread: 0, ready: 0, review: 0 });

  const context = await browser.newContext({
    storageState,
    viewport: { height: 800, width: 1280 },
  });

  const page = await context.newPage();

  await openHome(page, badgeServer);

  const sideNav = page.getByRole("navigation", { name: "Main" });

  await expect(sideNav).toBeVisible();
  await expect(page.locator("[data-nav-badge]")).toHaveCount(0);

  await Promise.all(
    destinations.map(async (destination) => {
      await expect(sideNav.getByRole("link", { exact: true, name: destination })).toBeVisible();
    }),
  );

  await page.setViewportSize({ height: 844, width: 390 });

  const tabBar = page.getByRole("navigation", { name: "Quick sections" });

  await expect(tabBar).toBeVisible();
  await expect(page.locator("[data-nav-badge]")).toHaveCount(0);

  await Promise.all(
    destinations.map(async (destination) => {
      await expect(tabBar.getByRole("link", { exact: true, name: destination })).toBeVisible();
    }),
  );

  await context.close();
  await request.dispose();
});

test("a seeded user's shell shows the live counts at 1280 and 390", async ({
  badgeServer,
  browser,
}) => {
  const { request, storageState } = await freshUser(badgeServer);

  const seeded = await request.post(`${badgeServer.url}/__test__/home/sample`, {
    data: { email: authTestIdentity.ownerEmail, variant: "running" },
  });

  expect(seeded.ok()).toBe(true);

  const counts = await navCounts(request);
  const home = homeCountsSchema.parse(await (await request.get("/api/home")).json());

  expect(counts.ready).toBe(home.ready.ready);
  expect(counts.review).toBe(home.reviews.total);
  expect(counts.ready).toBeGreaterThan(0);
  expect(counts.review).toBeGreaterThan(0);
  expect(counts.inboxUnread).toBeGreaterThan(0);

  const context = await browser.newContext({
    storageState,
    viewport: { height: 800, width: 1280 },
  });

  const page = await context.newPage();

  await openHome(page, badgeServer);

  const sideNav = page.getByRole("navigation", { name: "Main" });
  const readyLabel = `Ready, ${String(counts.ready)} to send`;
  const reviewLabel = `Review, ${String(counts.review)} waiting`;
  const inboxLabel = `Inbox, ${String(counts.inboxUnread)} unread`;

  await expect(sideNav).toBeVisible();
  await expect(sideNav.locator('[data-nav-badge="ready"]')).toHaveText(String(counts.ready));
  await expect(sideNav.locator('[data-nav-badge="review"]')).toHaveText(String(counts.review));
  await expect(sideNav.locator('[data-nav-badge="inbox"]')).toHaveText(String(counts.inboxUnread));

  await expect(sideNav.getByRole("link", { exact: true, name: readyLabel })).toBeVisible();
  await expect(sideNav.getByRole("link", { exact: true, name: reviewLabel })).toBeVisible();
  await expect(sideNav.getByRole("link", { exact: true, name: inboxLabel })).toBeVisible();

  await page.setViewportSize({ height: 844, width: 390 });

  const tabBar = page.getByRole("navigation", { name: "Quick sections" });

  await expect(tabBar).toBeVisible();
  await expect(tabBar.locator('[data-nav-badge="ready"]')).toHaveText(String(counts.ready));
  await expect(tabBar.locator('[data-nav-badge="review"]')).toHaveText(String(counts.review));
  await expect(tabBar.locator('[data-nav-badge="inbox"]')).toHaveText(String(counts.inboxUnread));

  await context.close();
  await request.dispose();
});
