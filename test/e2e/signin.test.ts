import { authTestIdentity, personas } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import {
  clearSinkMail,
  latestMailLink,
  requestMagicLink,
  signInByMagicLink,
  sinkMailCount,
  verifyAuthState,
} from "./sign-in.ts";

test("the owner signs in from the sign-in screen with an emailed link", async ({
  page,
  isolatedAppServer,
}) => {
  const appServerUrl = isolatedAppServer.url;

  await page.goto(`${appServerUrl}/signin`);
  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Link sent to")).toBeVisible();

  const link = await latestMailLink(appServerUrl, page.request, authTestIdentity.ownerEmail);

  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Overture is ready" })).toBeVisible();

  const state = await verifyAuthState(appServerUrl, page.request);
  const owner = state.users.at(-1);

  expect(owner?.role).toBe("owner");
  expect(owner?.emailVerified).toBe(true);
  expect(state.sessions).toHaveLength(1);
});

test("the owner signs in with Google through the local identity server", async ({
  page,
  appServerUrl,
  identityServer,
}) => {
  await identityServer.setPersona(personas.owner("google-owner"));
  await page.goto(`${appServerUrl}/signin`);
  const googleButton = page.getByRole("button", { name: "Continue with Google" });

  await expect(googleButton).toBeEnabled();
  await googleButton.click();
  await expect(page.getByRole("heading", { name: "Overture is ready" })).toBeVisible();

  const state = await verifyAuthState(appServerUrl, page.request);
  const owner = state.users.at(-1);

  expect(owner?.role).toBe("owner");
  expect(state.accounts.map((account) => account.providerId)).toContain("google");
});

test("the owner signs in with LinkedIn through the local identity server", async ({
  page,
  appServerUrl,
  identityServer,
}) => {
  await identityServer.setPersona(personas.owner("linkedin-owner"));
  await page.goto(`${appServerUrl}/signin`);
  const linkedinButton = page.getByRole("button", { name: "Continue with LinkedIn" });

  await expect(linkedinButton).toBeEnabled();
  await linkedinButton.click();
  await expect(page.getByRole("heading", { name: "Overture is ready" })).toBeVisible();

  const state = await verifyAuthState(appServerUrl, page.request);

  expect(state.accounts.map((account) => account.providerId)).toContain("linkedin");
});

test("an unverified provider email is refused and no session is issued", async ({
  page,
  request,
  isolatedAppServer,
  identityServer,
}) => {
  const appServerUrl = isolatedAppServer.url;

  await identityServer.setPersona(personas.unverified("unverified-owner"));
  await page.goto(`${appServerUrl}/signin`);
  const googleButton = page.getByRole("button", { name: "Continue with Google" });

  await expect(googleButton).toBeEnabled();
  await googleButton.click();
  await expect(page.getByRole("alert")).toContainText(
    "That provider has not verified your email, so this app cannot let it in.",
  );

  const state = await verifyAuthState(appServerUrl, request);

  expect(state.sessions).toEqual([]);
  expect(state.users.map((user) => user.emailVerified)).toEqual([false]);
});

test("an email outside the allowlist is refused at the sign-in screen", async ({
  page,
  request,
  isolatedAppServer,
  identityServer,
}) => {
  const appServerUrl = isolatedAppServer.url;

  await identityServer.setPersona(personas.outsider("outsider-google"));
  await clearSinkMail(appServerUrl, request);

  await page.goto(`${appServerUrl}/signin`);
  const googleButton = page.getByRole("button", { name: "Continue with Google" });

  await expect(googleButton).toBeEnabled();
  await googleButton.click();
  await expect(
    page.getByText(
      "That email is not allowed in yet. Only the owner can sign in during this milestone.",
    ),
  ).toBeVisible();

  expect(await verifyAuthState(appServerUrl, request)).toMatchObject({
    users: [],
    accounts: [],
  });

  const outsider = personas.outsider("outsider-magic");
  const magic = await requestMagicLink(appServerUrl, request, outsider.email);

  expect(magic.status()).toBe(403);
  expect(await sinkMailCount(appServerUrl, request)).toBe(0);
});

test("the magic-link ask is rate limited to three per fifteen minutes", async ({
  request,
  isolatedAppServer,
}) => {
  const appServerUrl = isolatedAppServer.url;

  await clearSinkMail(appServerUrl, request);

  const first = await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  expect(first.ok()).toBe(true);

  const second = await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  expect(second.ok()).toBe(true);

  const third = await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  expect(third.ok()).toBe(true);

  const fourth = await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  expect(fourth.status()).toBe(429);
  expect(await sinkMailCount(appServerUrl, request)).toBe(3);
});

test("the bot check is required on the auth endpoints", async ({ request, isolatedAppServer }) => {
  const appServerUrl = isolatedAppServer.url;

  await clearSinkMail(appServerUrl, request);

  const magicLink = await request.post(`${appServerUrl}/api/auth/sign-in/magic-link`, {
    data: { email: authTestIdentity.ownerEmail, callbackURL: "/signin" },
    headers: { origin: appServerUrl },
  });

  expect(magicLink.status()).toBe(400);

  const social = await request.post(`${appServerUrl}/api/auth/sign-in/social`, {
    data: { provider: "google", callbackURL: "/signin" },
    headers: { origin: appServerUrl },
  });

  expect(social.status()).toBe(400);

  expect(await sinkMailCount(appServerUrl, request)).toBe(0);
  expect((await verifyAuthState(appServerUrl, request)).users).toEqual([]);
});

test("sign out of all devices ends every other session and keeps this one", async ({
  browser,
  page,
  request,
  isolatedAppServer,
}) => {
  const appServerUrl = isolatedAppServer.url;

  await signInByMagicLink(page, appServerUrl, request, authTestIdentity.ownerEmail);
  await expect(page.getByRole("heading", { name: "Overture is ready" })).toBeVisible();

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();

  await signInByMagicLink(otherPage, appServerUrl, request, authTestIdentity.ownerEmail);
  await expect(otherPage.getByRole("heading", { name: "Overture is ready" })).toBeVisible();

  expect((await verifyAuthState(appServerUrl, request)).sessions).toHaveLength(2);

  await page.goto(`${appServerUrl}/settings`);
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page.getByText("You are signed out on your other devices.")).toBeVisible();
  expect((await verifyAuthState(appServerUrl, request)).sessions).toHaveLength(1);

  await otherPage.goto(`${appServerUrl}/`);
  await expect(otherPage).toHaveURL(/\/signin/u);

  await otherContext.close();
});

test("a second sign-in method on the same verified email joins the one account", async ({
  browser,
  page,
  request,
  isolatedAppServer,
  identityServer,
}) => {
  const appServerUrl = isolatedAppServer.url;

  await identityServer.setPersona(personas.owner("google-owner"));
  await signInByMagicLink(page, appServerUrl, request, authTestIdentity.ownerEmail);
  await expect(page.getByRole("heading", { name: "Overture is ready" })).toBeVisible();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();

  await secondPage.goto(`${appServerUrl}/signin`);
  await secondPage.getByRole("button", { name: "Continue with Google" }).click();
  await expect(secondPage.getByRole("heading", { name: "Overture is ready" })).toBeVisible();
  await secondContext.close();

  const state = await verifyAuthState(appServerUrl, request);
  const ownerUsers = state.users.filter((user) => user.email === authTestIdentity.ownerEmail);
  const owner = ownerUsers.at(-1);

  expect(ownerUsers).toHaveLength(1);

  for (const account of state.accounts) {
    expect(account.userId).toBe(owner?.id);
  }

  expect(state.accounts.map((account) => account.providerId)).toContain("google");
});
