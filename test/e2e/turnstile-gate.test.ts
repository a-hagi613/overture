import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { requestMagicLink, setTurnstileScenario, sinkMailCount } from "./sign-in.ts";

test("a token issued for another action is refused before any mail is sent", async ({
  request,
  isolatedAppServer,
}) => {
  await setTurnstileScenario(request, isolatedAppServer.url, { action: "signin" });

  const response = await requestMagicLink(
    isolatedAppServer.url,
    request,
    authTestIdentity.ownerEmail,
  );

  expect(response.status()).toBe(403);
  expect(await sinkMailCount(isolatedAppServer.url, request)).toBe(0);
});

test("a token checked against a hostname outside the allowlist is refused", async ({
  request,
  isolatedAppServer,
}) => {
  await setTurnstileScenario(request, isolatedAppServer.url, {
    action: "magiclink",
    hostname: "evil.example.com",
  });

  const response = await requestMagicLink(
    isolatedAppServer.url,
    request,
    authTestIdentity.ownerEmail,
  );

  expect(response.status()).toBe(403);
  expect(await sinkMailCount(isolatedAppServer.url, request)).toBe(0);
});

test("a replayed token is refused on its second use", async ({ request, isolatedAppServer }) => {
  await setTurnstileScenario(request, isolatedAppServer.url, {
    action: "magiclink",
    outcome: "replay",
  });

  const first = await requestMagicLink(isolatedAppServer.url, request, authTestIdentity.ownerEmail);

  const replay = await requestMagicLink(
    isolatedAppServer.url,
    request,
    authTestIdentity.ownerEmail,
  );

  expect(first.status()).toBe(200);
  expect(replay.status()).toBe(403);
  expect(await sinkMailCount(isolatedAppServer.url, request)).toBe(1);
});

test("a siteverify error refuses the sign-in", async ({ request, isolatedAppServer }) => {
  await setTurnstileScenario(request, isolatedAppServer.url, {
    action: "magiclink",
    outcome: "error",
  });

  const response = await requestMagicLink(
    isolatedAppServer.url,
    request,
    authTestIdentity.ownerEmail,
  );

  expect(response.status()).toBe(403);
  expect(await sinkMailCount(isolatedAppServer.url, request)).toBe(0);
});

test("a request with no token or an over-long token is refused before verification", async ({
  request,
  isolatedAppServer,
}) => {
  const url = `${isolatedAppServer.url}/api/auth/sign-in/magic-link`;
  const data = { email: authTestIdentity.ownerEmail, callbackURL: "/signin" };

  const missing = await request.post(url, {
    data,
    headers: { "x-turnstile-action": "magiclink", origin: isolatedAppServer.url },
  });

  const tooLong = await request.post(url, {
    data,
    headers: {
      "x-captcha-response": "a".repeat(2049),
      "x-turnstile-action": "magiclink",
      origin: isolatedAppServer.url,
    },
  });

  expect(missing.status()).toBe(403);
  expect(tooLong.status()).toBe(403);
  expect(await sinkMailCount(isolatedAppServer.url, request)).toBe(0);
});

test("a valid token for the surface's action still sends the sign-in link", async ({
  request,
  isolatedAppServer,
}) => {
  await setTurnstileScenario(request, isolatedAppServer.url, { action: "magiclink" });

  const response = await requestMagicLink(
    isolatedAppServer.url,
    request,
    authTestIdentity.ownerEmail,
  );

  expect(response.status()).toBe(200);
  expect(await sinkMailCount(isolatedAppServer.url, request)).toBe(1);
});
