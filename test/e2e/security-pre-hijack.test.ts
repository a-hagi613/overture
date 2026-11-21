import { authTestIdentity } from "./auth.fixture.ts";
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
