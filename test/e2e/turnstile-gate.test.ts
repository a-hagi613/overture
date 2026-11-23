import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test, test as appTest } from "./app.fixture.ts";
import { serverEnvironment } from "./app-server.ts";
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

test("the generic OAuth sign-in path needs a sign-in token", async ({
  request,
  isolatedAppServer,
}) => {
  const url = `${isolatedAppServer.url}/api/auth/sign-in/oauth2`;
  const data = { callbackURL: "/signin", providerId: "google" };

  const missing = await request.post(url, {
    data,
    headers: { "x-turnstile-action": "signin", origin: isolatedAppServer.url },
  });

  const wrongAction = await request.post(url, {
    data,
    headers: {
      "x-captcha-response": authTestIdentity.turnstilePassToken,
      "x-turnstile-action": "magiclink",
      origin: isolatedAppServer.url,
    },
  });

  expect(missing.status()).toBe(403);
  expect(wrongAction.status()).toBe(403);
});

test("a trailing slash cannot skip the bot check on a gated endpoint", async ({
  request,
  isolatedAppServer,
}) => {
  const response = await request.post(`${isolatedAppServer.url}/api/auth/sign-in/magic-link/`, {
    data: { callbackURL: "/signin", email: authTestIdentity.ownerEmail },
    headers: { origin: isolatedAppServer.url },
  });

  expect(response.status()).toBe(403);
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

appTest("production refuses to boot when the Turnstile allowlist names localhost", async () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-e2e-turnstile-"));

  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...serverEnvironment({
        NODE_ENV: "production",
        APP_ORIGIN: "https://tryoverture.com",
        TURNSTILE_HOSTNAMES: "tryoverture.com,localhost",
      }),
      DATABASE_URL: join(directory, "overture.db"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      resolve({ code, stderr });
    });
  });

  expect(outcome.code).not.toBe(0);
  expect(outcome.stderr).toContain("TURNSTILE_HOSTNAMES must not include localhost in production.");
});

appTest("production refuses to boot with the test routes enabled", async () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-e2e-testroutes-"));

  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...serverEnvironment({
        NODE_ENV: "production",
        APP_ORIGIN: "https://tryoverture.com",
        TURNSTILE_HOSTNAMES: "tryoverture.com",
        ENABLE_TEST_ROUTES: "true",
      }),
      DATABASE_URL: join(directory, "overture.db"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      resolve({ code, stderr });
    });
  });

  expect(outcome.code).not.toBe(0);
  expect(outcome.stderr).toContain("ENABLE_TEST_ROUTES must not be true in production or on Fly.");
});

appTest("a Fly machine refuses to boot with the test routes enabled", async () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-e2e-flyroutes-"));

  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...serverEnvironment({
        FLY_APP_NAME: "overture-web",
        ENABLE_TEST_ROUTES: "true",
      }),
      DATABASE_URL: join(directory, "overture.db"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      resolve({ code, stderr });
    });
  });

  expect(outcome.code).not.toBe(0);
  expect(outcome.stderr).toContain("ENABLE_TEST_ROUTES must not be true in production or on Fly.");
});

appTest("production refuses to boot with AUTH_ALLOWED_HOSTS set", async () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-e2e-allowedhosts-"));

  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...serverEnvironment({
        NODE_ENV: "production",
        APP_ORIGIN: "https://tryoverture.com",
        AUTH_ALLOWED_HOSTS: "localhost",
        TURNSTILE_HOSTNAMES: "tryoverture.com",
      }),
      DATABASE_URL: join(directory, "overture.db"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      resolve({ code, stderr });
    });
  });

  expect(outcome.code).not.toBe(0);
  expect(outcome.stderr).toContain("AUTH_ALLOWED_HOSTS must be empty in production");
});

appTest("production refuses to boot when the current master key version has no key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-e2e-masterkey-"));

  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...serverEnvironment({
        NODE_ENV: "production",
        APP_ORIGIN: "https://tryoverture.com",
        MASTER_KEY_CURRENT: "2",
        TURNSTILE_HOSTNAMES: "tryoverture.com",
      }),
      DATABASE_URL: join(directory, "overture.db"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      resolve({ code, stderr });
    });
  });

  expect(outcome.code).not.toBe(0);
  expect(outcome.stderr).toContain("MASTER_KEY_V2 is not set");
});

appTest(
  "production refuses to boot when a version in the master-key chain is missing",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "overture-e2e-masterkey-gap-"));

    const child = spawn("bun", ["run", "src/server/main.ts"], {
      env: {
        ...serverEnvironment({
          NODE_ENV: "production",
          APP_ORIGIN: "https://tryoverture.com",
          MASTER_KEY_CURRENT: "3",
          MASTER_KEY_V3: Buffer.alloc(32, 9).toString("base64"),
          TURNSTILE_HOSTNAMES: "tryoverture.com",
        }),
        DATABASE_URL: join(directory, "overture.db"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      let stderr = "";

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("exit", (code) => {
        resolve({ code, stderr });
      });
    });

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("MASTER_KEY_V2 is missing");
  },
);
