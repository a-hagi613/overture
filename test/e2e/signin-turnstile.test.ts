import type { Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { clearSinkMail, setTurnstileScenario, sinkMailCount } from "./sign-in.ts";
import {
  expireTurnstileStub,
  setTurnstileBrowserScenario,
  turnstileStubCounts,
  turnstileStubLastRender,
  waitForTurnstileStub,
} from "./turnstile-browser.ts";

declare global {
  var __signInCls: number;
}

const labels = {
  email: "Email",
  magic: "Send sign-in link",
  sent: "Link sent to",
  verifying: "Verifying…",
};

const failureModes = [
  {
    mode: "error",
    message: "The bot check did not pass. Finish it again and retry.",
  },
  {
    mode: "timeout",
    message: "The bot check timed out. Try again.",
  },
  {
    mode: "expired",
    message: "The bot check expired. Try again.",
  },
] as const;

async function waitForPrewarm(page: Page) {
  await expect
    .poll(async () => (await turnstileStubCounts(page)).executes)
    .toBeGreaterThanOrEqual(2);
}

test("the bot check is interaction-only and pre-verified before the click", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileBrowserScenario(request, url, { delayMs: 750, mode: "pass" });
  await setTurnstileScenario(request, url, { action: "magiclink" });
  await clearSinkMail(url, request);
  await page.addInitScript(() => {
    globalThis.__signInCls = 0;
    new PerformanceObserver((list) => {
      const shifts = list.getEntries() as (PerformanceEntry & {
        hadRecentInput: boolean;
        value: number;
      })[];

      for (const entry of shifts) {
        if (!entry.hadRecentInput) {
          globalThis.__signInCls += entry.value;
        }
      }
    }).observe({ buffered: true, type: "layout-shift" });
  });

  await page.goto(`${url}/signin`);
  await waitForTurnstileStub(page);

  // The widget is warmed while the card renders: no click is needed to start the challenge.
  await waitForPrewarm(page);

  const beforeClick = await turnstileStubCounts(page);
  const lastRender = await turnstileStubLastRender(page);

  expect(beforeClick.renders).toBe(2);
  expect(beforeClick.executes).toBe(2);
  expect(lastRender?.appearance).toBe("interaction-only");
  expect(lastRender?.execution).toBe("execute");

  await page.getByLabel(labels.email).fill(authTestIdentity.ownerEmail);

  const started = await page.evaluate(() => performance.now());

  await page.getByRole("button", { name: labels.magic }).click();
  await expect(page.getByText(labels.sent)).toBeVisible();

  const clickToContinueMs = (await page.evaluate(() => performance.now())) - started;
  const cls = await page.evaluate(() => globalThis.__signInCls);
  const afterClick = await turnstileStubCounts(page);

  console.log(JSON.stringify({ clickToContinueMs: Math.round(clickToContinueMs), cls }));

  // The cached token is reused: the click starts no second challenge and no reset.
  expect(afterClick.executes).toBe(beforeClick.executes);
  expect(afterClick.renders).toBe(beforeClick.renders);
  expect(afterClick.resets).toBe(0);
  expect(clickToContinueMs).toBeLessThan(600);
  expect(await sinkMailCount(url, request)).toBe(1);
});

test("Verifying… keeps the primary button in place while a token is pending", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileBrowserScenario(request, url, { delayMs: 1_500, mode: "pass" });
  await setTurnstileScenario(request, url, { action: "magiclink" });
  await clearSinkMail(url, request);

  await page.goto(`${url}/signin`);
  await waitForTurnstileStub(page);
  await page.getByLabel(labels.email).fill(authTestIdentity.ownerEmail);

  const submit = page.getByRole("button", { name: labels.magic });
  const before = await submit.boundingBox();

  await submit.click();

  const verifying = page.getByRole("button", { name: labels.verifying });

  await expect(verifying).toBeVisible();

  const during = await verifying.boundingBox();

  expect(during?.x).toBe(before?.x);
  expect(during?.y).toBe(before?.y);
  expect(during?.width).toBe(before?.width);
  expect(during?.height).toBe(before?.height);

  await expect(page.getByText(labels.sent)).toBeVisible({ timeout: 10_000 });
  expect(await sinkMailCount(url, request)).toBe(1);
});

test("repeated clicks never render extra widgets or reset the challenge", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileBrowserScenario(request, url, { delayMs: 500, mode: "pass" });
  await setTurnstileScenario(request, url, { action: "magiclink" });
  await clearSinkMail(url, request);

  await page.goto(`${url}/signin`);
  await waitForTurnstileStub(page);
  await waitForPrewarm(page);
  await page.getByLabel(labels.email).fill(authTestIdentity.ownerEmail);

  const submit = page.getByRole("button", { name: labels.magic });

  await submit.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.click();
      element.click();
    }
  });
  await expect(page.getByText(labels.sent)).toBeVisible();

  const first = await turnstileStubCounts(page);

  expect(first.renders).toBe(2);
  expect(first.executes).toBe(2);
  expect(first.resets).toBe(0);
  expect(await sinkMailCount(url, request)).toBe(1);

  await page.getByRole("button", { name: "Send the link again" }).click();
  await expect.poll(async () => await sinkMailCount(url, request)).toBe(2);

  const second = await turnstileStubCounts(page);

  expect(second.renders).toBe(2);
  expect(second.executes).toBe(3);
  expect(second.resets).toBe(1);
});

for (const failure of failureModes) {
  test(`a ${failure.mode} bot check shows a clear message and retries without clearing the email`, async ({
    page,
    request,
    isolatedAppServer,
  }) => {
    const { url } = isolatedAppServer;

    await setTurnstileBrowserScenario(request, url, { delayMs: 25, mode: failure.mode });
    await setTurnstileScenario(request, url, { action: "magiclink" });
    await clearSinkMail(url, request);

    await page.goto(`${url}/signin`);
    await page.getByLabel(labels.email).fill(authTestIdentity.ownerEmail);

    const submit = page.getByRole("button", { name: labels.magic });

    await submit.click();

    await expect(page.getByRole("alert")).toContainText(failure.message);
    await expect(submit).toBeEnabled();
    await expect(page.getByLabel(labels.email)).toHaveValue(authTestIdentity.ownerEmail);

    await setTurnstileBrowserScenario(request, url, { delayMs: 25, mode: "pass" });
    await submit.click();

    await expect(page.getByText(labels.sent)).toBeVisible();
    expect(await sinkMailCount(url, request)).toBe(1);
  });
}

test("an expired token is refreshed in the background before the next click", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileBrowserScenario(request, url, { delayMs: 25, mode: "pass" });
  await setTurnstileScenario(request, url, { action: "magiclink" });
  await clearSinkMail(url, request);

  await page.goto(`${url}/signin`);
  await waitForTurnstileStub(page);
  await waitForPrewarm(page);
  await page.getByLabel(labels.email).fill(authTestIdentity.ownerEmail);

  const beforeExpiry = await turnstileStubCounts(page);

  await expireTurnstileStub(page);

  // Both cached tokens expire; each is fetched again without the user clicking.
  await expect
    .poll(async () => (await turnstileStubCounts(page)).executes)
    .toBe(beforeExpiry.executes + 2);

  const refreshed = await turnstileStubCounts(page);

  await page.getByRole("button", { name: labels.magic }).click();
  await expect(page.getByText(labels.sent)).toBeVisible();

  const afterClick = await turnstileStubCounts(page);

  expect(afterClick.executes).toBe(refreshed.executes);
  expect(await sinkMailCount(url, request)).toBe(1);
});

for (const width of [390, 1280]) {
  test(`the bot check is centred inside the input column without moving the button at ${String(width)}`, async ({
    page,
    request,
    isolatedAppServer,
  }) => {
    const { url } = isolatedAppServer;

    await page.setViewportSize({ height: width === 1280 ? 900 : 844, width });
    await setTurnstileBrowserScenario(request, url, { delayMs: 25, mode: "pass" });
    await setTurnstileScenario(request, url, { action: "magiclink" });

    await page.goto(`${url}/signin`);
    await waitForTurnstileStub(page);
    await waitForPrewarm(page);

    const submit = page.getByRole("button", { name: labels.magic });
    const hiddenButton = await submit.boundingBox();

    // Hold the challenge open long enough to measure the visible widget before it clears.
    await setTurnstileBrowserScenario(request, url, { delayMs: 2_000, mode: "interaction" });
    await page.reload();
    await waitForTurnstileStub(page);

    const widget = page.locator('[data-turnstile-stub="widget"]').first();

    await expect(widget).toBeVisible();

    const widgetBox = await widget.boundingBox();
    const cardBox = await page.locator('section[aria-labelledby="signin-heading"]').boundingBox();
    const visibleButton = await submit.boundingBox();

    expect(widgetBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(hiddenButton).not.toBeNull();
    expect(visibleButton).not.toBeNull();

    if (widgetBox !== null && cardBox !== null) {
      const widgetCentre = widgetBox.x + widgetBox.width / 2;
      const cardCentre = cardBox.x + cardBox.width / 2;

      expect(Math.abs(widgetCentre - cardCentre)).toBeLessThanOrEqual(1);
    }

    // The widget sits below the submit button, so showing it never moves the button.
    expect(visibleButton?.x).toBe(hiddenButton?.x);
    expect(visibleButton?.y).toBe(hiddenButton?.y);
    expect(visibleButton?.width).toBe(hiddenButton?.width);
    expect(visibleButton?.height).toBe(hiddenButton?.height);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflow).toBe(false);
  });
}
