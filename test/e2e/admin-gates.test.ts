import { request as apiRequest } from "@playwright/test";

import { startAccessServer } from "./access-server.ts";
import { adminPort, expect, startFreshAdminServer, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink, setTurnstileScenario } from "./sign-in.ts";
import { z } from "zod";

const DEMO_EMAIL = "test@email.com";

const userStateSchema = z.object({
  users: z.array(z.object({ email: z.string(), id: z.string() })),
});

const meResponseSchema = z.object({
  adminOwnerEmail: z.string().nullable(),
  user: z.object({ email: z.string() }).nullable(),
});

async function ownerCookieHeader(adminUrl: string) {
  const context = await apiRequest.newContext();

  await requestMagicLink(adminUrl, context, authTestIdentity.ownerEmail);

  const link = await latestMailLink(adminUrl, context, authTestIdentity.ownerEmail);

  await context.get(link);

  const state = await context.storageState();

  const header = state.cookies
    .filter((cookie) => cookie.domain.includes("localhost"))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  await context.dispose();

  return header;
}

test("the admin host sends / to /admin while the main host keeps its landing page", async ({
  request,
  adminAppUrl,
  adminAppServer,
}) => {
  const adminRoot = await request.get(`${adminAppUrl}/`, { maxRedirects: 0 });

  expect(adminRoot.status()).toBe(302);
  expect(adminRoot.headers()["location"]).toBe("/admin");

  const adminRootWithQuery = await request.get(`${adminAppUrl}/?from=profile`, {
    maxRedirects: 0,
  });

  expect(adminRootWithQuery.status()).toBe(302);
  expect(adminRootWithQuery.headers()["location"]).toBe("/admin?from=profile");

  const mainRoot = await request.get(`${adminAppServer.url}/`);

  expect(mainRoot.status()).toBe(200);
  expect(mainRoot.headers()["content-type"]).toContain("text/html");
});

test("a signed-in non-owner on the admin host gets the plain owner refusal page", async ({
  request,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
}) => {
  const cookieHeader = await ownerCookieHeader(adminIsolatedAppUrl);

  const state = await request.get(`${adminIsolatedAppServer.url}/__test__/auth/state`);
  const stateBody = userStateSchema.parse(await state.json());
  const ownerId = stateBody.users.find((user) => user.email === authTestIdentity.ownerEmail)?.id;

  expect(ownerId).toBeDefined();

  await request.post(`${adminIsolatedAppServer.url}/__test__/auth/role`, {
    data: { userId: ownerId, role: "user" },
  });

  const refused = await request.get(`${adminIsolatedAppUrl}/admin`, {
    headers: { accept: "text/html", cookie: cookieHeader },
  });

  expect(refused.status()).toBe(403);
  expect(refused.headers()["content-type"]).toContain("text/html");

  const body = await refused.text();

  expect(body).toContain("The admin portal is for the owner account");
  expect(body).toContain(`Sign out and use ${authTestIdentity.ownerEmail}.`);
  expect(body).not.toContain('id="root"');
});

test("the admin sign-in screen names the owner account and the main host never does", async ({
  page,
  request,
  adminAppUrl,
  adminAppServer,
}) => {
  await page.goto(`${adminAppUrl}/signin`);

  await expect(page.getByText("The owner's portal")).toBeVisible();
  await expect(page.getByText(`Sign in with ${authTestIdentity.ownerEmail}.`)).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Google/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Continue with LinkedIn/u })).toHaveCount(0);

  const adminMe = await request.get(`${adminAppUrl}/api/me`);
  const mainMe = await request.get(`${adminAppServer.url}/api/me`);

  expect(meResponseSchema.parse(await adminMe.json()).adminOwnerEmail).toBe(
    authTestIdentity.ownerEmail,
  );
  expect(meResponseSchema.parse(await mainMe.json()).adminOwnerEmail).toBeNull();
});

test("the admin host keeps its own Turnstile host and magic-link session when the app host differs", async ({
  page,
  request,
  identityServer,
  accessServer,
}) => {
  const port = adminPort(3);
  const appOrigin = `http://127.0.0.1:${String(port)}`;
  const adminOrigin = `http://localhost:${String(port)}`;

  const server = await startFreshAdminServer(identityServer, accessServer, 3, {
    ADMIN_ORIGIN: adminOrigin,
    APP_ORIGIN: appOrigin,
    DEMO_LOGIN_ENABLED: "true",
    TURNSTILE_HOSTNAMES: "",
  });

  try {
    await setTurnstileScenario(request, adminOrigin, {
      action: "magiclink",
      hostname: "localhost",
    });

    const sent = await requestMagicLink(adminOrigin, request, authTestIdentity.ownerEmail);

    expect(sent.status()).toBe(200);

    const demoHeaders = {
      "x-captcha-response": authTestIdentity.turnstilePassToken,
      "x-turnstile-action": "magiclink",
    };

    const demoOnAdminHost = await request.post(`${adminOrigin}/api/auth/demo/sign-in`, {
      data: { email: DEMO_EMAIL },
      headers: { ...demoHeaders, origin: adminOrigin },
    });

    const demoOnAppHost = await request.post(`${appOrigin}/api/auth/demo/sign-in`, {
      data: { email: DEMO_EMAIL },
      headers: { ...demoHeaders, origin: appOrigin },
    });

    expect(demoOnAdminHost.status()).toBe(404);
    expect(demoOnAppHost.status()).toBe(200);

    const link = await latestMailLink(adminOrigin, request, authTestIdentity.ownerEmail);

    expect(new URL(link).hostname).toBe("localhost");

    const accessToken = await accessServer.issueToken({ email: authTestIdentity.ownerEmail });

    await page.context().addCookies([
      {
        name: "CF_Authorization",
        value: accessToken,
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    await page.goto(link);

    await expect(page).toHaveURL(`${adminOrigin}/admin`);
    await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();

    const sessionCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name.includes("session") && cookie.domain.includes("localhost"),
    );

    expect(sessionCookie).toBeDefined();

    const me = await page.request.get(`${adminOrigin}/api/me`);

    expect(meResponseSchema.parse(await me.json()).user?.email).toBe(authTestIdentity.ownerEmail);
  } finally {
    await server.stop();
  }
});

test("the admin API is selected by the Host header and refuses requests without an Access credential", async ({
  request,
  adminAppServer,
  adminApiUrl,
}) => {
  const refused = await request.get(`${adminApiUrl}/overview`);

  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "access_required" });

  const onAppHost = await request.get(`${adminAppServer.url}/admin/api/overview`);

  expect(onAppHost.status()).toBe(401);
  expect(onAppHost.headers()["content-type"]).toContain("application/json");
  expect(await onAppHost.json()).toEqual({ error: "access_required" });
});

test("a malformed Host header does not crash the app", async ({ request, adminAppServer }) => {
  const response = await request.get(`${adminAppServer.url}/api/health`, {
    headers: { host: "bad host" },
  });

  expect(response.status()).toBe(200);
});

test("the admin API fails closed on an Access cookie that is not valid encoding", async ({
  request,
  adminApiUrl,
}) => {
  const refused = await request.get(`${adminApiUrl}/overview`, {
    headers: { cookie: "CF_Authorization=%E0%A4%A" },
  });

  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "access_required" });
});

test("the admin API refuses an Access credential it cannot verify", async ({
  request,
  adminApiUrl,
}) => {
  const foreignSigner = await startAccessServer();
  const foreignToken = await foreignSigner.issueToken({ email: authTestIdentity.ownerEmail });

  try {
    const foreign = await request.get(`${adminApiUrl}/overview`, {
      headers: { "cf-access-jwt-assertion": foreignToken },
    });

    expect(foreign.status()).toBe(401);
    expect(await foreign.json()).toEqual({ error: "access_required" });

    const wrongAudienceToken = await accessServerIssue({
      audience: "someone-else-audience",
    });

    const wrongAudience = await request.get(`${adminApiUrl}/overview`, {
      headers: { "cf-access-jwt-assertion": wrongAudienceToken },
    });

    expect(wrongAudience.status()).toBe(401);
    expect(await wrongAudience.json()).toEqual({ error: "access_required" });

    const wrongIssuerToken = await accessServerIssue({
      issuer: "https://other-team.cloudflareaccess.com",
    });

    const wrongIssuer = await request.get(`${adminApiUrl}/overview`, {
      headers: { "cf-access-jwt-assertion": wrongIssuerToken },
    });

    expect(wrongIssuer.status()).toBe(401);
    expect(await wrongIssuer.json()).toEqual({ error: "access_required" });
  } finally {
    await foreignSigner.stop();
  }
});

async function accessServerIssue(claims: { audience?: string; issuer?: string }) {
  const server = await startAccessServer();
  const token = await server.issueToken({ email: authTestIdentity.ownerEmail, ...claims });

  await server.stop();

  return token;
}

test("a valid Access token opens the admin directly with no magic link or passkey", async ({
  page,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  const token = await accessServer.issueToken({ email: authTestIdentity.ownerEmail });

  await page.context().addCookies([
    {
      name: "CF_Authorization",
      value: token,
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.goto(`${adminIsolatedAppUrl}/signin`);

  await expect(page).toHaveURL(`${adminIsolatedAppUrl}/admin`);
  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();

  const overview = await page.request.get(`${adminIsolatedAppUrl}/admin/api/overview`);

  expect(overview.status()).toBe(200);
});

test("a valid Access token for a non-owner is refused by the API and the page", async ({
  request,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  const token = await accessServer.issueToken({ email: "someone.else@example.com" });
  const headers = { "cf-access-jwt-assertion": token };

  const refused = await request.get(`${adminIsolatedAppUrl}/admin/api/overview`, { headers });

  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "owner_required" });

  const pageRefused = await request.get(`${adminIsolatedAppUrl}/admin`, {
    headers: { ...headers, accept: "text/html" },
  });

  expect(pageRefused.status()).toBe(403);
  expect(pageRefused.headers()["content-type"]).toContain("text/html");
  expect(await pageRefused.text()).toContain(`Sign out and use ${authTestIdentity.ownerEmail}.`);
});

test("a suspended owner is refused even with a valid Access token", async ({
  request,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  const token = await accessServer.issueToken({ email: authTestIdentity.ownerEmail });
  const headers = { "cf-access-jwt-assertion": token };

  const allowed = await request.get(`${adminIsolatedAppUrl}/admin/api/overview`, { headers });

  expect(allowed.status()).toBe(200);

  const state = await request.get(`${adminIsolatedAppServer.url}/__test__/auth/state`);

  const ownerId = userStateSchema
    .parse(await state.json())
    .users.find((user) => user.email === authTestIdentity.ownerEmail)?.id;

  expect(ownerId).toBeDefined();

  await request.post(`${adminIsolatedAppServer.url}/__test__/user/suspend`, {
    data: { suspended: true, userId: ownerId },
  });

  const refused = await request.get(`${adminIsolatedAppUrl}/admin/api/overview`, { headers });

  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "owner_required" });

  const pageRefused = await request.get(`${adminIsolatedAppUrl}/admin`, {
    headers: { ...headers, accept: "text/html" },
  });

  expect(pageRefused.status()).toBe(403);
});

test("the main host never accepts an Access JWT as a sign-in or admin credential", async ({
  request,
  adminAppServer,
  accessServer,
}) => {
  const token = await accessServer.issueToken({ email: authTestIdentity.ownerEmail });
  const headers = { "cf-access-jwt-assertion": token };

  const me = await request.get(`${adminAppServer.url}/api/me`, { headers });

  expect(me.status()).toBe(200);
  expect(meResponseSchema.parse(await me.json()).user).toBeNull();

  const adminApi = await request.get(`${adminAppServer.url}/admin/api/overview`, { headers });

  expect(adminApi.status()).toBe(401);
  expect(await adminApi.json()).toEqual({ error: "access_required" });
});
