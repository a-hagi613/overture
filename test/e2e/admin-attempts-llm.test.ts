import { AxeBuilder } from "@axe-core/playwright";
import type { Browser, BrowserContext } from "@playwright/test";
import { z } from "zod";

import {
  attemptLiveSchema,
  attemptReplaySchema,
  attemptsResponseSchema,
  llmUsageResponseSchema,
} from "../../src/web/lib/admin-api.ts";
import { safeExternalHttpUrl } from "../../src/web/routes/admin/attempts-format.ts";
import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function createBrowserUseSession(browserUseUrl: string, attemptTag: string) {
  const response = await fetch(`${browserUseUrl}/api/v4/browsers`, {
    body: JSON.stringify({
      metadata: { attemptId: attemptTag },
      proxyCountryCode: "ca",
      solveCaptchas: true,
      timeout: 15,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  return z.object({ id: z.string() }).parse(await response.json());
}

async function stopBrowserUseSession(browserUseUrl: string, sessionId: string) {
  await fetch(`${browserUseUrl}/api/v4/browsers/${sessionId}`, {
    body: JSON.stringify({ action: "stop" }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function expectPageResponsiveAndAccessible(
  browser: Browser,
  adminUrl: string,
  state: StorageState,
  path: string,
  heading: string,
  width: number,
  theme: "light" | "dark",
) {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();

  try {
    await page.addInitScript((stored) => {
      globalThis.localStorage.setItem("overture.theme", stored);
    }, theme);
    await page.setViewportSize({ height: 844, width });
    await page.goto(`${adminUrl}${path}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      h1Count: [...document.querySelectorAll("h1")].filter((el) =>
        el.checkVisibility({ visibilityProperty: true }),
      ).length,
      mainCount: [...document.querySelectorAll("main")].filter((el) =>
        el.checkVisibility({ visibilityProperty: true }),
      ).length,
      scroll: document.documentElement.scrollWidth,
    }));

    expect(
      overflow.scroll,
      `overflow on ${path} at ${String(width)}px ${theme}`,
    ).toBeLessThanOrEqual(overflow.client);
    expect(overflow.h1Count, `visible h1 count on ${path}`).toBe(1);
    expect(overflow.mainCount, `visible main count on ${path}`).toBe(1);

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(axe.violations, `axe violations on ${path} at ${String(width)}px ${theme}`).toEqual([]);
  } finally {
    await context.close();
  }
}

test("safeExternalHttpUrl accepts safe http/https URLs and rejects unsafe schemes", () => {
  expect(safeExternalHttpUrl("https://live.browser-use.test/session-1")).toBe(
    "https://live.browser-use.test/session-1",
  );
  expect(safeExternalHttpUrl("http://127.0.0.1:4123/replay.mp4")).toBe(
    "http://127.0.0.1:4123/replay.mp4",
  );
  const scriptScheme = "javascript";

  expect(safeExternalHttpUrl(`${scriptScheme}:alert(1)`)).toBeNull();
  expect(safeExternalHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  expect(safeExternalHttpUrl("http://evil.example/session")).toBeNull();
  expect(safeExternalHttpUrl(null)).toBeNull();
});

test("admin /admin/attempts renders filters, live view, replay and parses exact server JSON", async ({
  page,
  browser,
  captureAppServer,
  captureAppUrl,
  browserUseApi,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const { owner, userId } = await ownerContextFor(captureAppServer.url);
  const companyId = await seedCompany(owner, "Northwind Labs", "northwind.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "northwind");

  const activePostingId = await seedPosting(owner, {
    atsJobId: "adm5-active-1",
    boardId,
    companyId,
    title: "Staff Backend Engineer",
    url: "https://example.test/northwind/jobs/adm5-active-1",
  });

  const completedPostingId = await seedPosting(owner, {
    atsJobId: "adm5-done-2",
    boardId,
    companyId,
    title: "Platform Systems Lead",
    url: "https://example.test/northwind/jobs/adm5-done-2",
  });

  const blockedPostingId = await seedPosting(owner, {
    atsJobId: "adm5-blocked-3",
    boardId,
    companyId,
    title: "Principal Reliability Engineer",
    url: "https://example.test/northwind/jobs/adm5-blocked-3",
  });

  const timeoutPostingId = await seedPosting(owner, {
    atsJobId: "adm5-timeout-4",
    boardId,
    companyId,
    title: "Distributed Storage Engineer",
    url: "https://example.test/northwind/jobs/adm5-timeout-4",
  });

  const activeAppId = await seedApplication(owner, {
    postingId: activePostingId,
    status: "sending",
    userId,
  });

  const completedAppId = await seedApplication(owner, {
    postingId: completedPostingId,
    status: "sent",
    userId,
  });

  const blockedAppId = await seedApplication(owner, {
    postingId: blockedPostingId,
    status: "failed",
    userId,
  });

  const timeoutAppId = await seedApplication(owner, {
    postingId: timeoutPostingId,
    status: "failed",
    userId,
  });

  const liveSession = await createBrowserUseSession(browserUseApi.url, "adm5-live");
  const replaySession = await createBrowserUseSession(browserUseApi.url, "adm5-replay");

  await stopBrowserUseSession(browserUseApi.url, replaySession.id);

  const seedActive = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId: activeAppId,
      browserMs: 12_000,
      costMicros: 11_000,
      endedAt: null,
      n: 1,
      outcome: null,
      provider: "browser_use",
      providerSessionId: liveSession.id,
      proxyBytes: 850_000,
      userId,
    },
  });

  const seedCompleted = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId: completedAppId,
      browserMs: 54_000,
      costMicros: 28_800,
      n: 1,
      outcome: "sent",
      provider: "browser_use",
      providerSessionId: replaySession.id,
      proxyBytes: 2_710_000,
      userId,
    },
  });

  const seedBlocked = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId: blockedAppId,
      browserMs: 32_000,
      captchaSeen: true,
      costMicros: 14_500,
      n: 1,
      outcome: "captcha_blocked",
      provider: "kernel",
      proxyBytes: 1_200_000,
      userId,
    },
  });

  const seedTimeout = await owner.post("/__test__/attempts/seed", {
    data: {
      applicationId: timeoutAppId,
      browserMs: 90_000,
      costMicros: 0,
      errorCode: "step_timeout",
      n: 1,
      outcome: "timeout",
      provider: "local",
      proxyBytes: 0,
      userId,
    },
  });

  expect(seedActive.ok()).toBe(true);
  expect(seedCompleted.ok()).toBe(true);
  expect(seedBlocked.ok()).toBe(true);
  expect(seedTimeout.ok()).toBe(true);

  const activeAttemptId = z.object({ id: z.string() }).parse(await seedActive.json()).id;
  const completedAttemptId = z.object({ id: z.string() }).parse(await seedCompleted.json()).id;

  await openAdminAsOwner(page, captureAppUrl, accessServer.issueToken);

  const attemptsContract = attemptsResponseSchema.parse(
    await (await page.request.get(`${captureAppUrl}/admin/api/attempts`)).json(),
  );

  expect(attemptsContract.counts).toMatchObject({
    active: 1,
    all: 4,
    challenge_blocked: 1,
    completed: 1,
    timeout: 1,
  });

  const liveContract = attemptLiveSchema.parse(
    await (
      await page.request.get(`${captureAppUrl}/admin/api/attempts/${activeAttemptId}/live`)
    ).json(),
  );

  expect(liveContract.status).toBe("active");
  expect(liveContract.liveViewUrl).toContain(liveSession.id);

  const replayContract = attemptReplaySchema.parse(
    await (
      await page.request.get(`${captureAppUrl}/admin/api/attempts/${completedAttemptId}/replay`)
    ).json(),
  );

  expect(replayContract.recordingUrl).toContain(replaySession.id);

  await page.goto(`${captureAppUrl}/admin`);
  await page.getByRole("link", { name: "Inspect attempts" }).click();
  await expect(page).toHaveURL(/\/admin\/attempts$/u);
  await expect(page.getByRole("heading", { name: "Live attempts" })).toBeVisible();

  const attemptsTable = page.locator("table");

  await expect(attemptsTable.getByText("Staff Backend Engineer")).toBeVisible();
  await expect(attemptsTable.getByText("Platform Systems Lead")).toBeVisible();
  await expect(attemptsTable.getByText("Northwind Labs").first()).toBeVisible();

  await page.getByRole("button", { name: /Challenge blocked \(1\)/u }).click();
  await expect(attemptsTable.getByText("Principal Reliability Engineer")).toBeVisible();
  await expect(attemptsTable.getByText("Platform Systems Lead")).toHaveCount(0);

  await page.getByRole("button", { name: /Timeout \(1\)/u }).click();
  await expect(attemptsTable.getByText("Distributed Storage Engineer")).toBeVisible();
  await expect(attemptsTable.getByText("Principal Reliability Engineer")).toHaveCount(0);

  await page.getByRole("button", { name: /All \(4\)/u }).click();
  await expect(attemptsTable.getByText("Staff Backend Engineer")).toBeVisible();

  await page.getByLabel("Application ID").fill(completedAppId);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(attemptsTable.getByText("Platform Systems Lead")).toBeVisible();
  await expect(attemptsTable.getByText("Staff Backend Engineer")).toHaveCount(0);

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(attemptsTable.getByText("Staff Backend Engineer")).toBeVisible();

  const liveButton = attemptsTable.getByRole("button", { name: "Watch live" }).first();

  await liveButton.click();
  await expect(page.getByText("Session active")).toBeVisible();

  const liveLink = page.getByRole("link", { name: "Open live browser view" });

  await expect(liveLink).toHaveAttribute("href", new RegExp(liveSession.id, "u"));
  await expect(liveLink).toHaveAttribute("rel", "noopener noreferrer");

  const replayButton = attemptsTable
    .locator("tr", { hasText: "Platform Systems Lead" })
    .getByRole("button", { name: "View replay" });

  await replayButton.click();

  const replayLink = page.getByRole("link", { name: "Open replay recording" });

  await expect(replayLink).toHaveAttribute("href", new RegExp(replaySession.id, "u"));
  await expect(replayLink).toHaveAttribute("rel", "noopener noreferrer");

  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto(`${captureAppUrl}/admin/provider-report`);
  await page.getByRole("link", { name: "Inspect live attempts & replay" }).click();
  await expect(page).toHaveURL(/\/admin\/attempts$/u);

  await page.goto(`${captureAppUrl}/admin/attempts`);
  await expect(page.getByRole("heading", { name: "Live attempts" })).toBeVisible();

  const state = await page.context().storageState();

  await Promise.all([
    expectPageResponsiveAndAccessible(
      browser,
      captureAppUrl,
      state,
      "/admin/attempts",
      "Live attempts",
      390,
      "light",
    ),
    expectPageResponsiveAndAccessible(
      browser,
      captureAppUrl,
      state,
      "/admin/attempts",
      "Live attempts",
      390,
      "dark",
    ),
    expectPageResponsiveAndAccessible(
      browser,
      captureAppUrl,
      state,
      "/admin/attempts",
      "Live attempts",
      1280,
      "light",
    ),
    expectPageResponsiveAndAccessible(
      browser,
      captureAppUrl,
      state,
      "/admin/attempts",
      "Live attempts",
      1280,
      "dark",
    ),
  ]);
});

test("admin /admin/llm renders spend caps, purpose/model breakdowns, unexpected model alert and cache-hit rate", async ({
  page,
  browser,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const postUsage = async (payload: {
    cachedTokens: number;
    costMicros: number;
    inputTokens: number;
    model: string;
    outputTokens: number;
    purpose: string;
  }) => {
    const response = await fetch(`${adminIsolatedAppServer.url}/__test__/llm/usage`, {
      body: JSON.stringify({
        email: authTestIdentity.ownerEmail,
        ...payload,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.ok).toBe(true);
  };

  await postUsage({
    cachedTokens: 6000,
    costMicros: 25_000,
    inputTokens: 10_000,
    model: "claude-haiku-5-5",
    outputTokens: 800,
    purpose: "match.score",
  });
  await postUsage({
    cachedTokens: 0,
    costMicros: 450_000,
    inputTokens: 10_000,
    model: "claude-sonnet-4-6",
    outputTokens: 1200,
    purpose: "answer.draft",
  });

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const setDailyCap = await page.request.put(
    `${adminIsolatedAppUrl}/admin/api/settings/llm.daily_spend_cap_micros`,
    { data: { value: "2000000" } },
  );

  const setMonthlyCap = await page.request.put(
    `${adminIsolatedAppUrl}/admin/api/settings/llm.monthly_spend_cap_micros`,
    { data: { value: "30000000" } },
  );

  expect(setDailyCap.ok()).toBe(true);
  expect(setMonthlyCap.ok()).toBe(true);

  const usageContract = llmUsageResponseSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/llm-usage`)).json(),
  );

  expect(usageContract.today.costMicros).toBe(475_000);
  expect(usageContract.caps.dailySpendCapMicros).toBe(2_000_000);
  expect(usageContract.caps.monthlySpendCapMicros).toBe(30_000_000);
  expect(usageContract.byModel.find((row) => row.model === "claude-sonnet-4-6")?.unexpected).toBe(
    true,
  );
  expect(usageContract.byModel.find((row) => row.model === "claude-haiku-5-5")?.unexpected).toBe(
    false,
  );

  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await page.getByRole("link", { name: "Inspect LLM spend" }).click();
  await expect(page).toHaveURL(/\/admin\/llm$/u);
  await expect(page.getByRole("heading", { name: "LLM spend" })).toBeVisible();

  await expect(page.getByText("Daily cap $2.00")).toBeVisible();
  await expect(page.getByText("Monthly cap $30.00")).toBeVisible();
  await expect(page.getByText("30%").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Unexpected Anthropic model detected" }),
  ).toBeVisible();
  await expect(page.getByText("Unexpected model").first()).toBeVisible();
  await expect(page.getByText("Expected", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Filter calls by answer.draft" }).click();
  await expect(page.getByText("Filtered by purpose: answer.draft")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);

  await page.getByRole("button", { name: "Show all purposes" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);

  await page.goto(`${adminIsolatedAppUrl}/admin/provider-report`);
  await page.getByRole("link", { name: "Inspect LLM spend" }).click();
  await expect(page).toHaveURL(/\/admin\/llm$/u);

  await page.goto(`${adminIsolatedAppUrl}/admin/llm`);
  await expect(page.getByRole("heading", { name: "LLM spend" })).toBeVisible();

  const state = await page.context().storageState();

  await Promise.all([
    expectPageResponsiveAndAccessible(
      browser,
      adminIsolatedAppUrl,
      state,
      "/admin/llm",
      "LLM spend",
      390,
      "light",
    ),
    expectPageResponsiveAndAccessible(
      browser,
      adminIsolatedAppUrl,
      state,
      "/admin/llm",
      "LLM spend",
      390,
      "dark",
    ),
    expectPageResponsiveAndAccessible(
      browser,
      adminIsolatedAppUrl,
      state,
      "/admin/llm",
      "LLM spend",
      1280,
      "light",
    ),
    expectPageResponsiveAndAccessible(
      browser,
      adminIsolatedAppUrl,
      state,
      "/admin/llm",
      "LLM spend",
      1280,
      "dark",
    ),
  ]);
});
