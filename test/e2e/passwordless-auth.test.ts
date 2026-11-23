import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { readVerifications } from "./db.fixture.ts";
import {
  clearSinkMail,
  latestMailLink,
  requestMagicLink,
  setTurnstileScenario,
  sinkMailCount,
  verifyAuthState,
} from "./sign-in.ts";

const removedEndpoints = [
  {
    path: "/api/auth/sign-up/email",
    data: { email: "a@example.com", name: "A", password: "a-long-enough-password-813" },
  },
  {
    path: "/api/auth/sign-in/email",
    data: { email: "a@example.com", password: "a-long-enough-password-813" },
  },
  { path: "/api/auth/send-verification-email", data: { email: "a@example.com" } },
  { path: "/api/auth/request-password-reset", data: { email: "a@example.com" } },
  {
    path: "/api/auth/reset-password",
    data: { newPassword: "a-long-enough-password-813", token: "t" },
  },
] as const;

test("the password endpoints are gone and create nothing", async ({
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await clearSinkMail(url, request);

  const responses = await Promise.all(
    removedEndpoints.map(async (endpoint) => ({
      path: endpoint.path,
      ok: (
        await request.post(`${url}${endpoint.path}`, {
          data: endpoint.data,
          headers: { origin: url },
        })
      ).ok(),
    })),
  );

  expect(responses.filter((response) => response.ok)).toEqual([]);

  expect(await sinkMailCount(url, request)).toBe(0);

  const state = await verifyAuthState(url, request);

  expect(state.users).toEqual([]);
  expect(state.accounts).toEqual([]);
  expect(state.sessions).toEqual([]);
});

for (const path of ["/forgot-password", "/reset-password?token=abc"]) {
  test(`${path} is not a route any more`, async ({ page, isolatedAppServer }) => {
    await page.goto(`${isolatedAppServer.url}${path}`);
    await expect(page.getByLabel(/password/iu)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /password/iu })).toHaveCount(0);
  });
}

test("the sign-in screen offers no password, sign-up or reset", async ({
  page,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await page.goto(`${url}/signin`);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Overture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText(/password/iu)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create an account" })).toHaveCount(0);
});

test("a magic link signs the owner in and stores no password", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await clearSinkMail(url, request);
  await setTurnstileScenario(request, url, { action: "magiclink" });
  expect((await requestMagicLink(url, request, authTestIdentity.ownerEmail)).ok()).toBe(true);

  await page.goto(await latestMailLink(url, request, authTestIdentity.ownerEmail));
  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();

  const state = await verifyAuthState(url, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  expect(owner?.emailVerified).toBe(true);
  expect(state.accounts.filter((account) => account.userId === owner?.id)).toEqual([]);
});

test("a magic-link token is stored hashed and the mailed link still signs in", async ({
  request,
  isolatedAppServer,
}) => {
  const { url, databasePath } = isolatedAppServer;

  await clearSinkMail(url, request);
  await setTurnstileScenario(request, url, { action: "magiclink" });
  expect((await requestMagicLink(url, request, authTestIdentity.ownerEmail)).ok()).toBe(true);

  const link = await latestMailLink(url, request, authTestIdentity.ownerEmail);
  const token = new URL(link).searchParams.get("token");

  expect(token).not.toBeNull();

  const rows = readVerifications(databasePath);

  expect(rows.length).toBeGreaterThan(0);
  expect(JSON.stringify(rows)).not.toContain(token ?? "");

  const verified = await request.get(link, { maxRedirects: 0 });

  expect(verified.status()).toBeGreaterThanOrEqual(300);
  expect(verified.status()).toBeLessThan(400);
  expect(verified.headers()["set-cookie"]).toContain("session_token");

  const state = await verifyAuthState(url, request);

  expect(state.sessions.length).toBe(1);
});
