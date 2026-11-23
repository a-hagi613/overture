import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { clearSinkMail, latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const supportResponseSchema = z.object({
  ok: z.literal(true),
  referenceId: z.string().min(1),
});

const sinkMailSchema = z.object({
  messages: z.array(
    z.object({
      body: z.string(),
      subject: z.string(),
      to: z.string(),
    }),
  ),
});

const validRequest = {
  category: "bug",
  subject: "Sending stops at the review step",
  message: "Every time I approve a card the app returns to the review screen.",
} as const;

async function signInAsOwner(appServerUrl: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
  await clearSinkMail(appServerUrl, request);

  return request;
}

async function ownerIdOf(request: APIRequestContext, appServerUrl: string) {
  const state = await verifyAuthState(appServerUrl, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error("The signed-in owner is missing from the auth state.");
  }

  return owner.id;
}

async function sinkMail(request: APIRequestContext) {
  const response = await request.get("/__test__/mail");

  return sinkMailSchema.parse(await response.json()).messages;
}

appTest("support refuses an unauthenticated request", async ({ isolatedAppServer }) => {
  const request = await apiRequest.newContext({ baseURL: isolatedAppServer.url });

  const response = await request.post("/api/support", { data: validRequest });

  expect(response.status()).toBe(401);
  expect(await sinkMail(request)).toEqual([]);

  await request.dispose();
});

appTest(
  "support rejects an invalid category, subject or message",
  async ({ isolatedAppServer }) => {
    const request = await signInAsOwner(isolatedAppServer.url);

    const invalidBodies = [
      { ...validRequest, category: "other" },
      { ...validRequest, subject: "ab" },
      { ...validRequest, message: "too short" },
    ];

    const statuses = await Promise.all(
      invalidBodies.map(async (data) => {
        const response = await request.post("/api/support", { data });

        return response.status();
      }),
    );

    expect(statuses).toEqual([400, 400, 400]);

    expect(await sinkMail(request)).toEqual([]);

    await request.dispose();
  },
);

appTest("support emails the message with the user's details", async ({ isolatedAppServer }) => {
  const request = await signInAsOwner(isolatedAppServer.url);
  const userId = await ownerIdOf(request, isolatedAppServer.url);

  const response = await request.post("/api/support", { data: validRequest });

  expect(response.status()).toBe(201);

  const body = supportResponseSchema.parse(await response.json());

  expect(body.ok).toBe(true);

  const messages = await sinkMail(request);

  expect(messages).toHaveLength(1);

  const [message] = messages;

  expect(message?.to).toBe("hello@tryoverture.com");
  expect(message?.subject).toBe(`[Overture Support - bug] ${validRequest.subject}`);
  expect(message?.body).toContain(`Reference: ${body.referenceId}`);
  expect(message?.body).toContain(`User ID: ${userId}`);
  expect(message?.body).toContain(`Name: ${authTestIdentity.ownerName}`);
  expect(message?.body).toContain(`Email: ${authTestIdentity.ownerEmail}`);
  expect(message?.body).toContain("Category: bug");
  expect(message?.body).toContain(`Subject: ${validRequest.subject}`);
  expect(message?.body).toContain(validRequest.message);

  await request.dispose();
});

appTest("support delivers to the configured support address", async ({ identityServer }) => {
  const server = await startFreshAppServer(identityServer, {
    SUPPORT_EMAIL: "support@example.com",
  });

  try {
    const request = await signInAsOwner(server.url);

    const response = await request.post("/api/support", { data: validRequest });

    expect(response.status()).toBe(201);

    const [message] = await sinkMail(request);

    expect(message?.to).toBe("support@example.com");

    await request.dispose();
  } finally {
    await server.stop();
  }
});

appTest(
  "support allows five messages an hour and then returns 429",
  async ({ isolatedAppServer }) => {
    const request = await signInAsOwner(isolatedAppServer.url);

    const statuses = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const response = await request.post("/api/support", { data: validRequest });

        return response.status();
      }),
    );

    expect(statuses).toEqual([201, 201, 201, 201, 201]);

    const refused = await request.post("/api/support", { data: validRequest });

    expect(refused.status()).toBe(429);
    expect(await sinkMail(request)).toHaveLength(5);

    await request.dispose();
  },
);

appTest("support returns 502 when mail delivery fails", async ({ isolatedAppServer }) => {
  const request = await signInAsOwner(isolatedAppServer.url);

  await request.post("/__test__/mail/fail-next", { data: { count: 1 } });

  const response = await request.post("/api/support", { data: validRequest });

  expect(response.status()).toBe(502);
  expect(z.object({ error: z.string() }).parse(await response.json()).error).toBe(
    "mail_send_failed",
  );

  await request.dispose();
});
