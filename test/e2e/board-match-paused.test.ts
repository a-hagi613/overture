import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ pausedServer: AppServer }>({
  pausedServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const serverNow = Date.UTC(2026, 10, 17, 11, 15, 0);

const okSchema = z.object({ ok: z.boolean() });

const pauseReasons = [
  {
    action: "Resume",
    copy: "Nothing new is sent until you resume.",
    href: null,
    reason: "user",
    title: "Paused by you.",
  },
  {
    action: "Finish setup",
    copy: "Sending starts once your facts, forwarding and consent are in.",
    href: "/onboarding",
    reason: "onboarding",
    title: "Setup isn't finished.",
  },
  {
    action: "Upload resume",
    copy: "Overture sends only the exact file you upload, so it needs one first.",
    href: "/profile/resume",
    reason: "no_resume",
    title: "No resume on file.",
  },
  {
    action: "Choose a plan",
    copy: "Sending stopped when it ran out. Your queue and history are kept.",
    href: "/profile/billing",
    reason: "plan_ended",
    title: "Your plan has ended.",
  },
  {
    action: "Update payment",
    copy: "Sending stays paused until the card is updated.",
    href: "/profile/billing",
    reason: "payment_failed",
    title: "Payment didn't go through.",
  },
  {
    action: "Contact support",
    copy: "Sending is paused while we check it. Support can tell you more.",
    href: "mailto:hello@tryoverture.com",
    reason: "suspended",
    title: "Your account is under review.",
  },
  {
    action: "Set up forwarding",
    copy: "We need your ATS mail forwarded to see replies and confirmations.",
    href: "/profile/details",
    reason: "no_mailbox",
    title: "Forwarding isn't set up.",
  },
] as const;

async function moveClockTo(request: APIRequestContext, target: number) {
  const current = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  const moved = await request.post("/__test__/clock/offset", {
    data: { offsetMs: target - current.now },
  });

  expect(moved.ok()).toBe(true);
}

async function seedPausedHome(request: APIRequestContext, appServerUrl: string) {
  await moveClockTo(request, serverNow);

  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  const response = await request.post("/__test__/home/sample", {
    data: { email: authTestIdentity.ownerEmail, variant: "paused" },
  });

  okSchema.parse(await response.json());
}

async function setPauseReason(request: APIRequestContext, reason: string) {
  const response = await request.post("/__test__/home/pause", {
    data: { email: authTestIdentity.ownerEmail, pauseReason: reason },
  });

  expect(response.ok()).toBe(true);
}

async function expectPausedHomeMatchesBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedPausedHome(request, appServerUrl);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: width === 1280 ? 2001 : 3245, width },
  });

  const page = await context.newPage();

  await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/`);

  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();
  await expect(page.getByText("Auto-apply paused")).toBeVisible();
  await expect(page.getByText("Paused by you.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page.getByText("Held while sending is paused")).toBeVisible();
  await expect(page.getByText("3rd in line")).toBeVisible();
  await expect(page.getByText("Next send around 14:20 once sending resumes.")).toBeVisible();
  await expect(page.getByText("Weekly check-in")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How is the search going?" })).toBeVisible();
  await expect(page.getByText("Sent · confirmed").first()).toBeVisible();
  await expect(page.getByText("Couldn't apply", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The form changed after we had filled it in, so we stopped before sending."),
  ).toBeVisible();
  await expect(page.getByText("Nothing was charged.")).toBeVisible();
  await expect(page.getByText("Tier 2 · Strengthen your profile")).toBeVisible();
  await expect(page.getByText("Add two facts from your last role")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent in your Inbox" })).toBeVisible();

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  await page.setViewportSize({ width, height: contentHeight });

  await expect(page).toHaveScreenshot(`${String(width)}-${theme}.png`, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });

  await context.close();
}

for (const width of [1280, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`the paused Home page matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      pausedServer,
    }) => {
      await expectPausedHomeMatchesBoard(browser, pausedServer.url, width, theme);
    });
  }
}

test("every pause reason shows the drawn copy and one fix", async ({ browser, pausedServer }) => {
  const request = await apiRequest.newContext({ baseURL: pausedServer.url });

  await seedPausedHome(request, pausedServer.url);

  const storageState = await request.storageState();

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: 1071, width: 1280 },
  });

  const page = await context.newPage();

  await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

  async function checkReason(index: number) {
    const entry: (typeof pauseReasons)[number] | undefined = pauseReasons[index];

    if (entry === undefined) {
      return;
    }

    await setPauseReason(request, entry.reason);
    await page.goto(`${pausedServer.url}/`);

    await expect(page.getByText(entry.title)).toBeVisible();
    await expect(page.getByText(entry.copy)).toBeVisible();

    if (entry.href === null) {
      await expect(page.getByRole("button", { name: entry.action })).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: entry.action })).toHaveAttribute(
        "href",
        entry.href,
      );
    }

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations, entry.reason).toEqual([]);

    await checkReason(index + 1);
  }

  await checkReason(0);

  await request.dispose();
  await context.close();
});
