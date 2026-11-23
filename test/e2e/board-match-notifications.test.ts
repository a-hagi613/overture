import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ notificationServer: AppServer }>({
  notificationServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const TIME_ZONE = "America/Toronto";

function at(hour: number, minute: number, day = 17) {
  return Date.UTC(2026, 10, day, hour + 5, minute);
}

const todayRows = [
  {
    at: at(7, 4),
    body: "Overture prepared your applications this morning. Nothing is sent until you approve.",
    kind: "ready",
    title: "Recap: 10 ready to approve, 2 need an answer",
    url: "/ready",
  },
  {
    at: at(9, 41),
    body: "Answering it lets 4 applications go ahead.",
    kind: "review",
    title: "A question for you",
    url: "/review",
  },
  {
    at: at(10, 15),
    body: "About Site Reliability Engineer. Read it in Inbox.",
    kind: "reply",
    title: "Halden Systems replied",
    url: "/inbox",
  },
  {
    at: at(10, 32),
    body: "Senior Backend Engineer. Open the thread in Inbox to see the details.",
    kind: "interview",
    title: "Interview request: Larkspur Health",
    url: "/inbox",
  },
  {
    at: at(11, 3),
    body: "Based on their email. Undo if it is wrong.",
    kind: "stage_move",
    title: "Moved to Screening: Halden Systems",
    url: "/board",
  },
  {
    at: at(12, 20),
    body: "Paste it within 10 minutes, or the application ends and can be tried again later.",
    kind: "code_wait",
    title: "Northwind Labs needs a code",
    url: "/",
  },
  {
    at: at(13, 5),
    body: "Sending stays paused until the card is updated.",
    kind: "paused",
    read: true,
    title: "Payment didn’t go through.",
    url: "/profile/account",
  },
  {
    at: at(15, 0),
    body: "Between 14:00 and 15:00. Open Home to see why each one stopped.",
    kind: "failed",
    title: "Couldn’t apply to 2 applications",
    url: "/",
  },
];

const earlierRows = [
  {
    at: at(9, 0, 16),
    body: "4 sent, 1 reply. Halden Systems replied about Site Reliability Engineer.",
    kind: "digest",
    read: true,
    title: "Recap: yesterday",
    url: "/",
  },
];

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  const clock = z
    .object({ now: z.number() })
    .parse(await (await request.get(`${appServerUrl}/__test__/clock`)).json());

  await request.post(`${appServerUrl}/__test__/clock/offset`, {
    data: { offsetMs: Date.UTC(2026, 10, 17, 16, 0, 0) - clock.now },
  });
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
}

async function seedRows(
  request: APIRequestContext,
  rows: {
    at: number;
    body: string;
    kind: string;
    read?: boolean;
    title: string;
    url: string;
  }[],
) {
  const response = await request.post("/__test__/notifications/seed", {
    data: { email: authTestIdentity.ownerEmail, rows },
  });

  expect(response.ok()).toBe(true);
}

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`the notification list matches the ${String(width)} ${theme} board`, async ({
      browser,
      notificationServer,
    }) => {
      const request = await apiRequest.newContext({ baseURL: notificationServer.url });

      await seedOwner(request, notificationServer.url);
      await seedRows(request, [...todayRows, ...earlierRows]);

      const storage = await request.storageState();

      await request.dispose();

      const variant = `${String(width)}-${theme}`;

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState: storage,
        timezoneId: TIME_ZONE,
        viewport: { height: width === 1280 ? 900 : 844, width },
      });

      const page = await context.newPage();

      await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

      if (theme === "dark") {
        await page.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      await page.goto(`${notificationServer.url}/notifications`);
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
      await expect(page.getByText("Recap: 10 ready to approve, 2 need an answer")).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      await expect(page.getByTestId("notifications-today")).toBeVisible();

      const { violations } = await new AxeBuilder({ page }).analyze();

      expect(violations, variant).toEqual([]);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(overflow, variant).toBe(false);

      await context.close();
    });
  }
}

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`the empty notification list matches the ${String(width)} ${theme} board`, async ({
      browser,
      notificationServer,
    }) => {
      const request = await apiRequest.newContext({ baseURL: notificationServer.url });

      await seedOwner(request, notificationServer.url);

      const storage = await request.storageState();

      await request.dispose();

      const variant = `empty-${String(width)}-${theme}`;

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState: storage,
        timezoneId: TIME_ZONE,
        viewport: { height: width === 1280 ? 900 : 844, width },
      });

      const page = await context.newPage();

      await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

      if (theme === "dark") {
        await page.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      await page.goto(`${notificationServer.url}/notifications`);
      await expect(page.getByRole("heading", { name: "Nothing yet." })).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      await expect(page.getByTestId("notifications-empty")).toBeVisible();

      const { violations } = await new AxeBuilder({ page }).analyze();

      expect(violations, variant).toEqual([]);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(overflow, variant).toBe(false);

      await context.close();
    });
  }
}
