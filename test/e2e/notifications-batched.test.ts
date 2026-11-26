import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ notificationsServerUrl: string }>({
  notificationsServerUrl: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server.url);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const notificationsSchema = z.object({
  notifications: z.array(
    z.object({
      body: z.string(),
      createdAt: z.number(),
      id: z.string(),
      kind: z.string(),
      readAt: z.number().nullable(),
      title: z.string(),
      url: z.string(),
    }),
  ),
  unread: z.number(),
});

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
}

async function notificationsOf(request: APIRequestContext) {
  return notificationsSchema.parse(await (await request.get("/api/notifications")).json());
}

async function emit(
  request: APIRequestContext,
  kind: string,
  title: string,
  body: string,
  url: string,
) {
  const response = await request.post("/__test__/notifications/emit", {
    data: { body, email: authTestIdentity.ownerEmail, kind, title, url },
  });

  expect(response.ok()).toBe(true);
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("a fresh user's question burst shows one grouped notification", async ({
  browser,
  notificationsServerUrl,
}) => {
  const request = await apiRequest.newContext({ baseURL: notificationsServerUrl });

  await seedOwner(request, notificationsServerUrl);

  for (let index = 0; index < 16; index += 1) {
    await emit(
      request,
      "review",
      "A question for you",
      "Open Review to answer it so these applications can go ahead.",
      "/review",
    );
  }

  const state = await notificationsOf(request);

  expect(state.notifications).toHaveLength(1);
  expect(state.notifications[0]?.title).toBe("16 questions need an answer");
  expect(state.unread).toBe(1);

  const storage = await request.storageState();
  const context = await browser.newContext({
    storageState: storage,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(`${notificationsServerUrl}/notifications`);

  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  await expect(page.getByText("16 questions need an answer")).toBeVisible();
  await expect(
    page.getByText("Answer them in Review so these applications can go ahead."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Review" })).toHaveAttribute("href", "/review");
  await expect(page.getByRole("link", { name: "Notifications, 1 unread" })).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).analyze();

  expect(violations).toEqual([]);

  await context.close();
  await request.dispose();
});

test("a fresh user sees one notification per kind, never one per event", async ({
  browser,
  notificationsServerUrl,
}) => {
  const request = await apiRequest.newContext({ baseURL: notificationsServerUrl });

  await seedOwner(request, notificationsServerUrl);

  for (const [kind, title, body, url] of [
    [
      "review",
      "A question for you",
      "Open Review to answer it so these applications can go ahead.",
      "/review",
    ],
    ["reply", "Acme replied", "About Senior Backend Engineer. Read it in Inbox.", "/inbox"],
    [
      "interview",
      "Interview request: Larkspur",
      "Staff Platform Engineer. Open the thread in Inbox to see the details.",
      "/inbox",
    ],
  ] as const) {
    for (let index = 0; index < 4; index += 1) {
      await emit(request, kind, title, body, url);
    }
  }

  const state = await notificationsOf(request);

  expect(state.notifications).toHaveLength(3);
  expect(state.notifications.map((row) => row.kind).sort()).toEqual([
    "interview",
    "reply",
    "review",
  ]);
  expect(state.notifications.every((row) => row.readAt === null)).toBe(true);

  const storage = await request.storageState();
  const context = await browser.newContext({
    storageState: storage,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  await page.goto(`${notificationsServerUrl}/notifications`);

  await expect(page.getByText("4 questions need an answer")).toBeVisible();
  await expect(page.getByText("4 employers replied")).toBeVisible();
  await expect(page.getByText("4 interview requests")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications, 3 unread" })).toBeVisible();

  await context.close();
  await request.dispose();
});
