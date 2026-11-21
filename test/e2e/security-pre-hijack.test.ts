import { authTestIdentity, personas } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import {
  latestMailLink,
  requestMagicLink,
  setTurnstileScenario,
  signInWithPassword,
  signUpWithPassword,
  verifyAuthState,
} from "./sign-in.ts";

const ATTACKER_PASSWORD = "attacker-password-1";

test("a magic link revokes the password a pre-registered address never proved", async ({
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileScenario(request, url, { action: "signup" });
  expect(
    (
      await signUpWithPassword(url, request, {
        email: authTestIdentity.ownerEmail,
        password: ATTACKER_PASSWORD,
      })
    ).ok(),
  ).toBe(true);

  await setTurnstileScenario(request, url, { action: "magiclink" });
  expect((await requestMagicLink(url, request, authTestIdentity.ownerEmail)).ok()).toBe(true);

  const link = await latestMailLink(url, request, authTestIdentity.ownerEmail);

  await request.get(link);

  const state = await verifyAuthState(url, request);
  const owner = state.users.filter((user) => user.email === authTestIdentity.ownerEmail);

  expect(owner).toHaveLength(1);
  expect(owner[0]?.emailVerified).toBe(true);
  expect(state.accounts.filter((account) => account.userId === owner[0]?.id)).toHaveLength(0);

  await setTurnstileScenario(request, url, { action: "signin" });

  const attacker = await signInWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password: ATTACKER_PASSWORD,
  });

  expect(attacker.ok()).toBe(false);
  expect((await verifyAuthState(url, request)).sessions).toHaveLength(1);
});

test("a verified password account keeps its password when Google signs in", async ({
  page,
  request,
  isolatedAppServer,
  identityServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileScenario(request, url, { action: "signup" });
  expect(
    (
      await signUpWithPassword(url, request, {
        email: authTestIdentity.ownerEmail,
        password: ATTACKER_PASSWORD,
      })
    ).ok(),
  ).toBe(true);

  const link = await latestMailLink(url, request, authTestIdentity.ownerEmail);

  await request.get(link);

  await setTurnstileScenario(request, url, { action: "signin" });
  await identityServer.setPersona(personas.owner("google-owner-keeps-password"));
  await page.goto(`${url}/signin`);
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();

  const state = await verifyAuthState(url, request);
  const owner = state.users.filter((user) => user.email === authTestIdentity.ownerEmail);

  expect(owner).toHaveLength(1);
  expect(
    state.accounts
      .filter((account) => account.userId === owner[0]?.id)
      .map((account) => account.providerId)
      .toSorted(),
  ).toEqual(["credential", "google"]);

  await setTurnstileScenario(request, url, { action: "signin" });

  const password = await signInWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password: ATTACKER_PASSWORD,
  });

  expect(password.ok()).toBe(true);
});

test("a suspended unverified registration is not resurrected by a verified provider sign-in", async ({
  page,
  request,
  isolatedAppServer,
  identityServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileScenario(request, url, { action: "signup" });
  await signUpWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password: ATTACKER_PASSWORD,
  });

  const registered = await verifyAuthState(url, request);

  const registeredOwner = registered.users.find(
    (user) => user.email === authTestIdentity.ownerEmail,
  );

  expect(
    (
      await request.post(`${url}/__test__/user/suspend`, {
        data: { userId: registeredOwner?.id, suspended: true },
      })
    ).ok(),
  ).toBe(true);

  await setTurnstileScenario(request, url, { action: "signin" });
  await identityServer.setPersona(personas.owner("google-owner-suspended"));
  await page.goto(`${url}/signin`);
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page).toHaveURL(/error=account_not_linked/u);

  const state = await verifyAuthState(url, request);
  const owners = state.users.filter((user) => user.email === authTestIdentity.ownerEmail);

  expect(owners).toHaveLength(1);
  expect(owners[0]?.emailVerified).toBe(false);
  expect(state.accounts.map((account) => account.providerId)).toEqual(["credential"]);
  expect(state.sessions).toHaveLength(0);
});
