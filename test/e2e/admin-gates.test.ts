import { request as apiRequest } from "@playwright/test";

import { startAccessServer } from "./access-server.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./admin.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";
import { z } from "zod";

const userStateSchema = z.object({ users: z.array(z.object({ id: z.string() })) });

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

test("the admin API is selected by the Host header and refuses requests without an Access credential", async ({
  request,
  adminAppServer,
  adminApiUrl,
}) => {
  const refused = await request.get(`${adminApiUrl}/overview`);

  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "access_required" });

  const onAppHost = await request.get(`${adminAppServer.url}/admin/api/overview`);

  expect(onAppHost.headers()["content-type"]).toContain("text/html");
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

test("the admin API refuses a valid Access credential without the owner's session", async ({
  request,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  const token = await accessServer.issueToken({ email: authTestIdentity.ownerEmail });

  const refused = await request.get(`${adminIsolatedAppUrl}/admin/api/overview`, {
    headers: { "cf-access-jwt-assertion": token },
  });

  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "sign_in_required" });
});

test("the admin API refuses a session that is not the owner or has no recent passkey", async ({
  request,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  const cookieHeader = await ownerCookieHeader(adminIsolatedAppUrl);
  const token = await accessServer.issueToken({ email: authTestIdentity.ownerEmail });
  const headers = { "cf-access-jwt-assertion": token, cookie: cookieHeader };

  const noPasskey = await request.get(`${adminIsolatedAppUrl}/admin/api/overview`, { headers });

  expect(noPasskey.status()).toBe(403);
  expect(await noPasskey.json()).toEqual({ error: "passkey_required" });

  const state = await request.get(`${adminIsolatedAppServer.url}/__test__/auth/state`);
  const stateBody = userStateSchema.parse(await state.json());
  const ownerId = stateBody.users[0]?.id;

  expect(ownerId).toBeDefined();

  await request.post(`${adminIsolatedAppServer.url}/__test__/auth/role`, {
    data: { userId: ownerId, role: "user" },
  });

  const nonOwner = await request.get(`${adminIsolatedAppUrl}/admin/api/overview`, { headers });

  expect(nonOwner.status()).toBe(403);
  expect(await nonOwner.json()).toEqual({ error: "owner_required" });
});
