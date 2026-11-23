import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { ownerContextFor } from "./matching-harness.ts";

const demoEmail = "test@email.com";

const test = appTest.extend<{ supportServer: AppServer }>({
  supportServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, { DEMO_LOGIN_ENABLED: "true" });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const supportResponseSchema = z.object({ ok: z.literal(true), referenceId: z.string() });

const errorSchema = z.object({ error: z.string() });

const validationErrorSchema = z.object({
  error: z.literal("invalid_request"),
  issues: z.array(z.unknown()).min(1),
});

const ticketsSchema = z.object({
  tickets: z.array(
    z.object({
      category: z.string(),
      hasMessage: z.boolean(),
      referenceId: z.string(),
      status: z.string(),
      subject: z.string(),
      userId: z.string(),
    }),
  ),
});

const mailSchema = z.object({
  messages: z.array(
    z.object({
      replyTo: z.string().nullable(),
      subject: z.string(),
      to: z.string(),
    }),
  ),
});

const ONE_HOUR_MS = 60 * 60_000;

async function repeat(times: number, attempt: () => Promise<void>) {
  if (times === 0) {
    return;
  }

  await attempt();
  await repeat(times - 1, attempt);
}

async function ticketsFor(request: APIRequestContext, userId: string) {
  const path = `/__test__/support-tickets?userId=${encodeURIComponent(userId)}`;

  return ticketsSchema.parse(await (await request.get(path)).json()).tickets;
}

async function mailFor(request: APIRequestContext) {
  return mailSchema.parse(await (await request.get("/__test__/mail")).json()).messages;
}

async function signInDemo(request: APIRequestContext, url: string) {
  const response = await request.post(`${url}/api/auth/demo/sign-in`, {
    data: { email: demoEmail },
    headers: {
      "x-captcha-response": authTestIdentity.turnstilePassToken,
      "x-turnstile-action": "magiclink",
      origin: url,
    },
  });

  expect(response.ok()).toBe(true);
}

test("a support request is stored for the queue and mailed with the sender as Reply-To", async ({
  supportServer,
}) => {
  const { owner, userId } = await ownerContextFor(supportServer.url);

  const response = await owner.post("/api/support", {
    data: {
      category: "billing",
      message: "I was charged twice for the same week. Could you check it?",
      subject: "Charged twice",
    },
  });

  expect(response.status()).toBe(201);

  const body = supportResponseSchema.parse(await response.json());

  expect(body.referenceId).toMatch(/^SUP-[0-9A-F]{8}$/u);

  const tickets = await ticketsFor(owner, userId);

  expect(tickets).toEqual([
    {
      category: "billing",
      hasMessage: true,
      referenceId: body.referenceId,
      status: "open",
      subject: "Charged twice",
      userId,
    },
  ]);

  const messages = (await mailFor(owner)).filter(
    (message) => message.to === "admin@tryoverture.com",
  );

  expect(messages).toHaveLength(1);
  expect(messages[0]?.replyTo).toBe(authTestIdentity.ownerEmail);
  expect(messages[0]?.subject).toBe(`[${body.referenceId}] Charged twice`);

  await owner.dispose();
});

test("an invalid body answers the shared invalid_request shape", async ({ supportServer }) => {
  const { owner } = await ownerContextFor(supportServer.url);

  const response = await owner.post("/api/support", {
    data: { category: "billing" },
  });

  expect(response.status()).toBe(400);
  validationErrorSchema.parse(await response.json());

  await owner.dispose();
});

test("the demo account cannot open a support ticket", async ({ supportServer }) => {
  const demo = await apiRequest.newContext({ baseURL: supportServer.url });

  await signInDemo(demo, supportServer.url);

  const response = await demo.post("/api/support", {
    data: { category: "other", message: "Demo question", subject: "Demo" },
  });

  expect(response.status()).toBe(403);
  expect(errorSchema.parse(await response.json()).error).toBe("demo_locked");
  expect(await mailFor(demo)).toHaveLength(0);

  await demo.dispose();
});

test("a mail failure answers 502 but keeps the ticket for the queue", async ({ supportServer }) => {
  const { owner, userId } = await ownerContextFor(supportServer.url);

  await owner.post("/__test__/mail/clear");
  await owner.post("/__test__/mail/fail-next", { data: { count: 1 } });

  const failed = await owner.post("/api/support", {
    data: { category: "bug", message: "The Calendar lost my event.", subject: "Lost event" },
  });

  expect(failed.status()).toBe(502);

  const failedBody = z
    .object({ error: z.literal("mail_send_failed"), referenceId: z.string() })
    .parse(await failed.json());

  expect(failedBody.referenceId).toMatch(/^SUP-/u);

  const tickets = await ticketsFor(owner, userId);

  expect(tickets).toHaveLength(1);
  expect(tickets[0]?.referenceId).toBe(failedBody.referenceId);
  expect(await mailFor(owner)).toHaveLength(0);

  await owner.dispose();
});

test("the support limit refuses the eleventh request in an hour", async ({ supportServer }) => {
  const { owner } = await ownerContextFor(supportServer.url);

  await repeat(10, async () => {
    const response = await owner.post("/api/support", {
      data: { category: "other", message: "A question", subject: "Question" },
    });

    expect(response.status()).toBe(201);
  });

  const refused = await owner.post("/api/support", {
    data: { category: "other", message: "One more", subject: "Question" },
  });

  expect(refused.status()).toBe(429);
  expect(errorSchema.parse(await refused.json()).error).toBe("rate_limited");

  await owner.post("/__test__/clock/offset", { data: { offsetMs: ONE_HOUR_MS + 1000 } });

  const nextWindow = await owner.post("/api/support", {
    data: { category: "other", message: "Next hour", subject: "Question" },
  });

  expect(nextWindow.status()).toBe(201);

  await owner.dispose();
});
