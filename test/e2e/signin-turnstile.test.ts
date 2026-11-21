import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { clearSinkMail, setTurnstileScenario, sinkMailCount } from "./sign-in.ts";
import {
  setTurnstileBrowserScenario,
  turnstileStubCounts,
  waitForTurnstileStub,
} from "./turnstile-browser.ts";

const labels = {
  email: "Email",
  magic: "Email me a sign-in link",
  sent: "Link sent to",
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

test("a click shows pending feedback at once and runs a single bot check", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileBrowserScenario(request, url, { delayMs: 750, mode: "pass" });
  await setTurnstileScenario(request, url, { action: "magiclink" });
  await clearSinkMail(url, request);

  await page.goto(`${url}/signin`);
  await waitForTurnstileStub(page);

  expect((await turnstileStubCounts(page)).renders).toBe(0);

  await page.getByLabel(labels.email).fill(authTestIdentity.ownerEmail);
  const submit = page.getByRole("button", { name: labels.magic });

  await submit.click();

  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await expect(page.getByText(labels.sent)).toBeVisible();

  const counts = await turnstileStubCounts(page);

  expect(counts.renders).toBe(1);
  expect(counts.executes).toBe(1);
  expect(counts.resets).toBe(0);
  expect(await sinkMailCount(url, request)).toBe(1);
});

test("mode switches and repeated clicks never render extra widgets or reset the challenge", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileBrowserScenario(request, url, { delayMs: 500, mode: "pass" });
  await setTurnstileScenario(request, url, { action: "magiclink" });
  await clearSinkMail(url, request);

  await page.goto(`${url}/signin`);
  await page.getByLabel(labels.email).fill(authTestIdentity.ownerEmail);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();

  expect((await turnstileStubCounts(page)).renders).toBe(0);

  const submit = page.getByRole("button", { name: labels.magic });

  await submit.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.click();
      element.click();
    }
  });
  await expect(page.getByText(labels.sent)).toBeVisible();

  const first = await turnstileStubCounts(page);

  expect(first.renders).toBe(1);
  expect(first.executes).toBe(1);
  expect(first.resets).toBe(0);
  expect(await sinkMailCount(url, request)).toBe(1);

  await page.getByRole("button", { name: "Send the link again" }).click();
  await expect.poll(async () => await sinkMailCount(url, request)).toBe(2);

  const second = await turnstileStubCounts(page);

  expect(second.renders).toBe(1);
  expect(second.executes).toBe(2);
  expect(second.resets).toBe(1);
});

for (const failure of failureModes) {
  test(`a ${failure.mode} bot check shows a clear message and retries cleanly`, async ({
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

    await setTurnstileBrowserScenario(request, url, { delayMs: 25, mode: "pass" });
    await submit.click();

    await expect(page.getByText(labels.sent)).toBeVisible();
    expect(await sinkMailCount(url, request)).toBe(1);
  });
}
