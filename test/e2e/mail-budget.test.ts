import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import { requestMagicLink, verifyAuthState } from "./sign-in.ts";

const cloudflareEnvironment = {
  CLOUDFLARE_EMAIL_API_TOKEN: "e2e-cloudflare-email-api-token",
  CLOUDFLARE_ACCOUNT_ID: "e2e-cloudflare-account-id",
  MAIL_FROM: "no-reply@tryoverture.com",
} as const;

const sendUrl =
  "https://api.cloudflare.com/client/v4/accounts/e2e-cloudflare-account-id/email/sending/send";

const cloudflareRequestListSchema = z.object({
  requests: z.array(z.object({ body: z.string(), method: z.string(), url: z.string() })),
});

const cloudflareMessageSchema = z.object({ subject: z.string(), text: z.string() });

const magicLinkPattern = /(?<url>https?:\/\/\S+)/u;

const READY_AT = 1_800_000_000_000;

const mailUsageSchema = z.object({
  month: z.string(),
  total: z.number(),
  cap: z.number(),
  reserve: z.number(),
  noticeLimit: z.number(),
  auth: z.number(),
  system: z.number(),
  notice: z.number(),
  warnedAt: z.number().nullable(),
  reserveRefusedAt: z.number().nullable(),
  refusedAt: z.number().nullable(),
});

const notificationsSchema = z.object({
  notifications: z.array(
    z.object({
      body: z.string(),
      emailedAt: z.number().nullable(),
      kind: z.string(),
      title: z.string(),
    }),
  ),
});

async function mailUsage(request: APIRequestContext) {
  return mailUsageSchema.parse(await (await request.get("/__test__/mail/usage")).json());
}

async function seedMailUsage(
  request: APIRequestContext,
  usage: { auth: number; system: number; notice: number },
) {
  return mailUsageSchema.parse(
    await (await request.post("/__test__/mail/usage", { data: usage })).json(),
  );
}

async function cloudflareRequests(request: APIRequestContext) {
  return cloudflareRequestListSchema.parse(
    await (await request.get("/__test__/cloudflare-email")).json(),
  ).requests;
}

async function alertsFor(request: APIRequestContext, userId: string) {
  const body = notificationsSchema.parse(
    await (await request.get(`/__test__/notifications?userId=${userId}`)).json(),
  );

  return body.notifications.filter((note) => note.kind === "alert");
}

async function signInOwner(serverUrl: string, request: APIRequestContext) {
  const sent = await requestMagicLink(serverUrl, request, authTestIdentity.ownerEmail);

  expect(sent.ok()).toBe(true);

  const calls = await cloudflareRequests(request);
  const [call] = calls.slice(-1);

  if (call === undefined) {
    throw new Error("the sign-in mail did not reach Cloudflare Email Sending");
  }

  const message = cloudflareMessageSchema.parse(JSON.parse(call.body));
  const link = magicLinkPattern.exec(message.text)?.groups?.["url"];

  if (link === undefined) {
    throw new Error("the sign-in mail carried no link");
  }

  await request.get(link);

  const state = await verifyAuthState(serverUrl, request);
  const user = state.users.find((candidate) => candidate.email === authTestIdentity.ownerEmail);

  return user?.id ?? "";
}

async function seedReadyApplication(request: APIRequestContext, userId: string) {
  const companyId = await seedCompany(request, "Reserve Recaps", "reserve-recaps.example");
  const boardId = await seedBoard(request, companyId, "greenhouse", "reserve-recaps");

  const postingId = await seedPosting(request, {
    atsJobId: "reserve-1",
    boardId,
    companyId,
    title: "Platform Engineer",
    url: "https://reserve-recaps.example/jobs/1",
  });

  return seedApplication(request, { postingId, readyAt: READY_AT, status: "ready", userId });
}

async function runRecap(request: APIRequestContext, userId: string) {
  return request.post("/__test__/jobs/run-now", {
    data: { kind: "ready.notify", payload: JSON.stringify({ since: 0, userId }) },
  });
}

test("the 2,701st send of the month is refused, and the owner is alerted once", async ({
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, cloudflareEnvironment);

  try {
    const request = await apiRequest.newContext({ baseURL: server.url });
    const userId = await signInOwner(server.url, request);

    await request.post("/__test__/cloudflare-email/clear", { data: {} });

    const seeded = await seedMailUsage(request, { auth: 2700, notice: 0, system: 0 });

    expect(seeded).toMatchObject({ cap: 2700, noticeLimit: 2430, reserve: 270, total: 2700 });

    await seedReadyApplication(request, userId);

    const run = await runRecap(request, userId);

    expect(run.ok()).toBe(true);
    expect(await cloudflareRequests(request)).toHaveLength(0);

    const after = await mailUsage(request);

    expect(after.total).toBe(2700);
    expect(after.refusedAt).not.toBeNull();

    const alerts = await alertsFor(request, userId);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toBe("Overture alert: mail.cap");
    expect(alerts[0]?.body).toContain('"stage":"refused"');

    const notes = notificationsSchema.parse(
      await (await request.get(`/__test__/notifications?userId=${userId}`)).json(),
    );

    const ready = notes.notifications.find((note) => note.kind === "ready");

    expect(ready?.emailedAt).toBeNull();

    const secondSignIn = await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);

    expect(secondSignIn.ok()).toBe(false);
    expect(await cloudflareRequests(request)).toHaveLength(0);
    expect(await alertsFor(request, userId)).toHaveLength(1);

    await request.dispose();
  } finally {
    await server.stop();
  }
});

test("a Recap is refused at the reserve while sign-in mail still goes, and the cap alert still fires at 2,700", async ({
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, cloudflareEnvironment);

  try {
    const request = await apiRequest.newContext({ baseURL: server.url });
    const userId = await signInOwner(server.url, request);

    await request.post("/__test__/cloudflare-email/clear", { data: {} });

    const seeded = await seedMailUsage(request, { auth: 0, notice: 2430, system: 0 });

    expect(seeded.total).toBe(seeded.noticeLimit);

    await seedReadyApplication(request, userId);

    const run = await runRecap(request, userId);

    expect(run.ok()).toBe(true);
    expect(await cloudflareRequests(request)).toHaveLength(0);

    const refused = await mailUsage(request);

    expect(refused.total).toBe(2430);
    expect(refused.notice).toBe(2430);
    expect(refused.reserveRefusedAt).not.toBeNull();
    expect(refused.refusedAt).toBeNull();

    const reserveAlerts = await alertsFor(request, userId);

    expect(reserveAlerts).toHaveLength(1);
    expect(reserveAlerts[0]?.body).toContain('"reason":"sign_in_reserve"');

    const magic = await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);

    expect(magic.ok()).toBe(true);

    const calls = await cloudflareRequests(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(sendUrl);

    const after = await mailUsage(request);

    expect(after).toMatchObject({ auth: 1, notice: 2430, total: 2431 });

    await seedMailUsage(request, { auth: 1, notice: 2699, system: 0 });
    await request.post("/__test__/cloudflare-email/clear", { data: {} });

    const overCap = await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);

    expect(overCap.ok()).toBe(false);
    expect(await cloudflareRequests(request)).toHaveLength(0);

    const full = await mailUsage(request);

    expect(full.total).toBe(2700);
    expect(full.reserveRefusedAt).not.toBeNull();
    expect(full.refusedAt).not.toBeNull();

    const alerts = await alertsFor(request, userId);
    const refusalBodies = alerts
      .map((alert) => alert.body)
      .filter((body) => body.includes('"stage":"refused"'));

    expect(refusalBodies).toHaveLength(2);
    expect(refusalBodies[0]).toContain('"reason":"sign_in_reserve"');
    expect(refusalBodies[1]).toContain('"reason":"monthly_cap"');

    await request.dispose();
  } finally {
    await server.stop();
  }
});

test("the owner is alerted once when the month crosses 80%", async ({ identityServer }) => {
  const server = await startFreshAppServer(identityServer, cloudflareEnvironment);

  try {
    const request = await apiRequest.newContext({ baseURL: server.url });
    const userId = await signInOwner(server.url, request);

    await request.post("/__test__/cloudflare-email/clear", { data: {} });
    await seedMailUsage(request, { auth: 2159, notice: 0, system: 0 });

    const magic = await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);

    expect(magic.ok()).toBe(true);

    const after = await mailUsage(request);

    expect(after.total).toBe(2160);
    expect(after.warnedAt).not.toBeNull();
    expect(await cloudflareRequests(request)).toHaveLength(1);

    const alerts = await alertsFor(request, userId);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.body).toContain('"stage":"warning"');

    await request.dispose();
  } finally {
    await server.stop();
  }
});

test("the month's count survives a restart", async ({ identityServer }) => {
  const server = await startFreshAppServer(identityServer);

  try {
    const { owner } = await ownerContextFor(server.url);

    expect((await mailUsage(owner)).total).toBe(1);

    await server.restart();

    const afterRestart = mailUsageSchema.parse(
      await (await fetch(`${server.url}/__test__/mail/usage`)).json(),
    );

    expect(afterRestart.total).toBe(1);

    const magic = await requestMagicLink(server.url, owner, authTestIdentity.ownerEmail);

    expect(magic.ok()).toBe(true);

    const afterSend = mailUsageSchema.parse(
      await (await fetch(`${server.url}/__test__/mail/usage`)).json(),
    );

    expect(afterSend.total).toBe(2);
  } finally {
    await server.stop();
  }
});
