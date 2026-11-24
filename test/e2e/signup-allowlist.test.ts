import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import {
  latestMailLink,
  requestMagicLink,
  setTurnstileScenario,
  verifyAuthState,
} from "./sign-in.ts";

const ALLOWED_EMAIL = "allowed.person@example.com";
const SECOND_ALLOWED_EMAIL = "second.allowed@example.com";
const REFUSED_EMAIL = "refused.person@example.com";

interface AllowlistFixtures {
  allowlistServer: AppServer;
  allowlistUrl: string;
}

const test = appTest.extend<AllowlistFixtures>({
  allowlistServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        ALLOWED_SIGNUP_EMAILS: `${ALLOWED_EMAIL}, ${SECOND_ALLOWED_EMAIL}`,
        PUBLIC_SIGNUP_ENABLED: "false",
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
  allowlistUrl: async ({ allowlistServer }, provide) => {
    await provide(allowlistServer.url);
  },
});

test("an allowlisted address signs up while public sign-up is off, without becoming an owner", async ({
  request,
  allowlistUrl,
}) => {
  await setTurnstileScenario(request, allowlistUrl, {
    action: "magiclink",
    hostname: "127.0.0.1",
  });

  const sent = await requestMagicLink(allowlistUrl, request, ALLOWED_EMAIL);

  expect(sent.status()).toBe(200);

  const link = await latestMailLink(allowlistUrl, request, ALLOWED_EMAIL);

  await request.get(link);

  const state = await verifyAuthState(allowlistUrl, request);
  const user = state.users.find((candidate) => candidate.email === ALLOWED_EMAIL);

  expect(user).toBeDefined();
  expect(user?.role).toBe("user");
  expect(state.sessions.some((session) => session.userId === user?.id)).toBe(true);
});

test("a non-allowlisted address is still refused while public sign-up is off", async ({
  request,
  allowlistUrl,
}) => {
  await setTurnstileScenario(request, allowlistUrl, {
    action: "magiclink",
    hostname: "127.0.0.1",
  });

  const sent = await requestMagicLink(allowlistUrl, request, REFUSED_EMAIL);

  expect(sent.status()).toBe(403);

  const state = await verifyAuthState(allowlistUrl, request);

  expect(state.users).toEqual([]);
});
