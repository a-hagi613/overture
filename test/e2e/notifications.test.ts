import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { decodePush, subscriptionKeys, vapidKeyPair } from "./push.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const vapid = vapidKeyPair();

const test = appTest.extend<{ pushServerUrl: string }>({
  pushServerUrl: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_PUBLIC_KEY: vapid.publicKey,
      });

      await provide(server.url);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const stateSchema = z.object({ users: z.array(z.object({ email: z.string(), id: z.string() })) });

const notificationSchema = z.object({
  body: z.string(),
  createdAt: z.number(),
  id: z.string(),
  kind: z.string(),
  pushedAt: z.number().nullable(),
  readAt: z.number().nullable(),
  title: z.string(),
  url: z.string(),
});

const notificationsSchema = z.object({
  notifications: z.array(notificationSchema),
});

const subscriptionsSchema = z.object({
  subscriptions: z.array(z.object({ endpoint: z.string() })),
});

const requestsSchema = z.object({
  requests: z.array(
    z.object({
      body: z.string(),
      headers: z.record(z.string(), z.string()),
      method: z.string(),
      url: z.string(),
    }),
  ),
});

const TOKEN = "push-notification-token";
const AT = Date.UTC(2026, 10, 17, 12, 0, 0);

async function json(response: APIResponse) {
  const body: unknown = await response.json();

  return body;
}

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
}

async function ownerIdOf(request: APIRequestContext) {
  const state = stateSchema.parse(await json(await request.get("/__test__/auth/state")));

  return state.users.find((user) => user.email === authTestIdentity.ownerEmail)?.id ?? "";
}

async function notificationsOf(request: APIRequestContext, userId: string) {
  return notificationsSchema.parse(
    await json(await request.get(`/__test__/notifications?userId=${encodeURIComponent(userId)}`)),
  );
}

async function seedRows(
  request: APIRequestContext,
  rows: { at: number; body: string; kind: string; read?: boolean; title: string; url: string }[],
) {
  const response = await request.post("/__test__/notifications/seed", {
    data: { email: authTestIdentity.ownerEmail, rows },
  });

  expect(response.ok()).toBe(true);
}

async function subscribe(request: APIRequestContext, endpoint: string) {
  const keys = subscriptionKeys();

  const response = await request.post("/api/push/subscribe", {
    data: { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } },
  });

  expect(response.ok()).toBe(true);

  return keys;
}

async function runPush(request: APIRequestContext, notificationId: string) {
  const response = await request.post("/__test__/jobs/run-now", {
    data: { kind: "push.notify", payload: JSON.stringify({ notificationId }) },
  });

  expect(response.ok()).toBe(true);
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("the notification list shows pushes, marks one or all read, and passes axe", async ({
  browser,
  pushServerUrl,
}) => {
  const request = await apiRequest.newContext({ baseURL: pushServerUrl });

  await seedOwner(request, pushServerUrl);
  await seedRows(request, [
    {
      at: AT,
      body: "Overture prepared your applications this morning. Nothing is sent until you approve.",
      kind: "ready",
      title: "Recap: 10 ready to approve, 2 need an answer",
      url: "/ready",
    },
    {
      at: AT + 60_000,
      body: "Answering it lets 4 applications go ahead.",
      kind: "review",
      title: "A question for you",
      url: "/review",
    },
    {
      at: AT + 120_000,
      body: "About Site Reliability Engineer. Read it in Inbox.",
      kind: "reply",
      title: "Halden Systems replied",
      url: "/inbox",
    },
  ]);

  const storage = await request.storageState();

  const context = await browser.newContext({
    storageState: storage,
    timezoneId: "America/Toronto",
  });

  const page = await context.newPage();

  await page.goto(`${pushServerUrl}/notifications`);

  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  await expect(page.getByText("Recap: 10 ready to approve, 2 need an answer")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Ready" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications, 3 unread" })).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).analyze();

  expect(violations).toEqual([]);

  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

  const after = await notificationsOf(request, await ownerIdOf(request));

  expect(after.notifications.every((row) => row.readAt !== null)).toBe(true);

  await context.close();
  await request.dispose();
});

test("the empty list shows the drawn empty state", async ({ browser, pushServerUrl }) => {
  const request = await apiRequest.newContext({ baseURL: pushServerUrl });

  await seedOwner(request, pushServerUrl);

  const storage = await request.storageState();
  const context = await browser.newContext({ storageState: storage });
  const page = await context.newPage();

  await page.goto(`${pushServerUrl}/notifications`);
  await expect(page.getByRole("heading", { name: "Nothing yet." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notification settings" })).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).analyze();

  expect(violations).toEqual([]);

  await context.close();
  await request.dispose();
});

test("the app installs as a PWA and its service worker never caches API responses", async ({
  browser,
  pushServerUrl,
}) => {
  const request = await apiRequest.newContext({ baseURL: pushServerUrl });

  await seedOwner(request, pushServerUrl);

  const manifest = z
    .object({
      icons: z.array(z.object({ sizes: z.string(), src: z.string() })),
      name: z.string(),
      start_url: z.string(),
    })
    .parse(await json(await request.get("/manifest.webmanifest")));

  expect(manifest.name).toBe("Overture");
  expect(manifest.start_url).toBe("/");
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );

  const statuses = await Promise.all(
    manifest.icons.map(async (icon) => (await request.get(icon.src)).status()),
  );

  expect(statuses).toEqual(manifest.icons.map(() => 200));

  const worker = await (await request.get("/sw.js")).text();

  expect(worker).not.toMatch(/caches\./u);
  expect(worker).not.toContain("caches.open");

  const storage = await request.storageState();
  const context = await browser.newContext({ storageState: storage });
  const page = await context.newPage();

  await page.goto(`${pushServerUrl}/notifications`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await fetch("/api/notifications");
  });

  expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);

  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);

  expect(controlled).toBe(true);

  await context.close();
  await request.dispose();
});

test("a subscription receives a push, a gone endpoint is deleted, and unsubscribe stops it", async ({
  pushServerUrl,
}) => {
  const request = await apiRequest.newContext({ baseURL: pushServerUrl });

  await seedOwner(request, pushServerUrl);
  const userId = await ownerIdOf(request);
  const keys = await subscribe(request, `https://push.example.test/send/${TOKEN}`);
  const goneKeys = await subscribe(request, `https://push.example.test/send/${TOKEN}/gone`);

  await seedRows(request, [
    {
      at: AT,
      body: "About Site Reliability Engineer.",
      kind: "reply",
      title: "First push",
      url: "/inbox",
    },
  ]);

  const seeded = await notificationsOf(request, userId);
  const [first] = seeded.notifications;

  if (first === undefined) {
    throw new Error("The seeded notification is missing.");
  }

  await runPush(request, first.id);

  const recorded = requestsSchema.parse(await json(await request.get("/__test__/push/requests")));

  expect(recorded.requests).toHaveLength(2);

  const delivered = recorded.requests.find(
    (entry) => entry.url === `https://push.example.test/send/${TOKEN}`,
  );

  if (delivered === undefined) {
    throw new Error("The push to the live endpoint is missing.");
  }

  expect(delivered.headers["ttl"]).toBe("86400");
  expect(delivered.headers["authorization"]).toContain("vapid t=");
  expect(decodePush(delivered.body, keys)).toEqual(
    expect.objectContaining({
      body: "About Site Reliability Engineer.",
      title: "First push",
      url: "/inbox",
    }),
  );
  expect(
    decodePush(
      recorded.requests.find((entry) => entry.url.endsWith("/gone"))?.body ?? "",
      goneKeys,
    ),
  ).toEqual(expect.objectContaining({ title: "First push" }));

  const remaining = subscriptionsSchema.parse(
    await json(
      await request.get(`/__test__/push/subscriptions?userId=${encodeURIComponent(userId)}`),
    ),
  );

  expect(remaining.subscriptions.map((row) => row.endpoint)).toEqual([
    `https://push.example.test/send/${TOKEN}`,
  ]);

  const pushed = await notificationsOf(request, userId);

  expect(pushed.notifications[0]?.pushedAt).not.toBeNull();

  await request.post("/__test__/push/clear");

  await seedRows(request, [
    { at: AT + 1000, body: "Second.", kind: "reply", title: "Second push", url: "/inbox" },
  ]);

  const secondRows = await notificationsOf(request, userId);
  const second = secondRows.notifications.find((row) => row.title === "Second push");

  if (second === undefined) {
    throw new Error("The second notification is missing.");
  }

  await runPush(request, second.id);

  const secondRecorded = requestsSchema.parse(
    await json(await request.get("/__test__/push/requests")),
  );

  expect(secondRecorded.requests).toHaveLength(1);

  const unsubscribed = await request.post("/api/push/unsubscribe", {
    data: { endpoint: `https://push.example.test/send/${TOKEN}` },
  });

  expect(unsubscribed.ok()).toBe(true);
  await request.post("/__test__/push/clear");
  await seedRows(request, [
    { at: AT + 2000, body: "Third.", kind: "reply", title: "Third push", url: "/inbox" },
  ]);

  const thirdRows = await notificationsOf(request, userId);
  const third = thirdRows.notifications.find((row) => row.title === "Third push");

  if (third === undefined) {
    throw new Error("The third notification is missing.");
  }

  await runPush(request, third.id);

  const thirdRecorded = requestsSchema.parse(
    await json(await request.get("/__test__/push/requests")),
  );

  expect(thirdRecorded.requests).toEqual([]);

  const none = subscriptionsSchema.parse(
    await json(
      await request.get(`/__test__/push/subscriptions?userId=${encodeURIComponent(userId)}`),
    ),
  );

  expect(none.subscriptions).toEqual([]);

  await request.dispose();
});

test("a push subscription must name a known push service over HTTPS", async ({ pushServerUrl }) => {
  const request = await apiRequest.newContext({ baseURL: pushServerUrl });

  await seedOwner(request, pushServerUrl);

  const keys = subscriptionKeys();
  const refused = ["http://fcm.googleapis.com/fcm/send/abc", "https://overture-web.internal/x"];

  const responses = await Promise.all(
    refused.map(async (endpoint) =>
      request.post("/api/push/subscribe", {
        data: { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } },
      }),
    ),
  );

  expect(responses.map((response) => response.status())).toEqual([400, 400]);

  await request.dispose();
});

test("an unauthenticated caller is refused before the body is validated", async ({
  pushServerUrl,
}) => {
  const request = await apiRequest.newContext({ baseURL: pushServerUrl });
  const keys = subscriptionKeys();

  const responses = [
    await request.get("/api/notifications"),
    await request.post("/api/notifications/read", { data: { id: 42 } }),
    await request.post("/api/notifications/read-all", {
      data: "{",
      headers: { "content-type": "application/json" },
    }),
    await request.get("/api/push"),
    await request.post("/api/push/subscribe", {
      data: { endpoint: "http://fcm.googleapis.com/fcm/send/abc", keys },
    }),
    await request.post("/api/push/subscribe", {
      data: { endpoint: "https://overture-web.internal/x", keys },
    }),
    await request.post("/api/push/unsubscribe", { data: { endpoint: "not a url" } }),
  ];

  for (const response of responses) {
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }

  const bodies = await Promise.all(responses.map(async (response) => json(response)));

  expect(bodies).toEqual(responses.map(() => ({ error: "sign_in_required" })));

  await request.dispose();
});

test("every authenticated notification response is marked no-store", async ({ pushServerUrl }) => {
  const request = await apiRequest.newContext({ baseURL: pushServerUrl });

  await seedOwner(request, pushServerUrl);

  const keys = subscriptionKeys();
  const endpoint = "https://push.example.test/send/no-store";

  const responses = [
    await request.get("/api/notifications"),
    await request.get("/api/push"),
    await request.post("/api/push/subscribe", {
      data: { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } },
    }),
    await request.post("/api/notifications/read", { data: { id: "unknown-notification" } }),
    await request.post("/api/notifications/read-all"),
    await request.post("/api/push/unsubscribe", { data: { endpoint } }),
  ];

  for (const response of responses) {
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }

  await request.dispose();
});
