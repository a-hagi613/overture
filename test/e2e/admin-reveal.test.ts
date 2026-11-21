import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import { expect, test } from "./admin.fixture.ts";
import { openAdminAsOwner } from "./admin-sign-in.ts";
import { lokiAuditEntries } from "./loki-server.ts";
import { latestMailLink, requestMagicLink, signInByMagicLink, verifyAuthState } from "./sign-in.ts";

const REVEAL_MS = 15 * 60 * 1000;
const PASSKEY_WINDOW_MS = 10 * 60 * 1000;

const detailSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const revealResponseSchema = z.object({
  reveal: z
    .object({
      expiresAt: z.number(),
      id: z.string(),
      openedAt: z.number(),
      reason: z.string(),
      remainingMs: z.number(),
      targetUserId: z.string(),
    })
    .nullable(),
});

const actAsSchema = z.object({
  view: z.object({
    board: z.array(z.object({ id: z.string() })),
    eeoAggregates: z.object({
      disability: z.array(z.object({ count: z.number(), value: z.string() })),
      ethnicity: z.array(z.object({ count: z.number(), value: z.string() })),
      gender: z.array(z.object({ count: z.number(), value: z.string() })),
      veteran: z.array(z.object({ count: z.number(), value: z.string() })),
    }),
    facts: z.array(z.object({ key: z.string(), value: z.string() })),
    reveal: z.object({ expiresAt: z.number(), targetUserId: z.string() }),
    user: z.object({ email: z.string(), id: z.string() }),
  }),
});

const auditSchema = z.object({
  audit: z.array(
    z.object({
      action: z.string(),
      detail: detailSchema,
      id: z.string(),
      reason: z.string(),
      targetUserId: z.string().nullable(),
    }),
  ),
});

const supportAccessSchema = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      at: z.number(),
      detail: detailSchema,
      id: z.string(),
      reason: z.string(),
    }),
  ),
});

const guestA = "guest.reveal.a@example.com";
const guestB = "guest.reveal.b@example.com";
const revealReason = "Checking a stuck application with the person";

async function invite(
  page: Parameters<typeof openAdminAsOwner>[0],
  adminBase: string,
  email: string,
) {
  const response = await page.request.post(`${adminBase}/invites`, { data: { email } });

  expect(response.status()).toBe(201);
}

async function guestSession(appUrl: string, email: string) {
  const context = await apiRequest.newContext();

  await requestMagicLink(appUrl, context, email);

  const link = await latestMailLink(appUrl, context, email);

  await context.get(link);

  return context;
}

test("a Reveal needs a fresh passkey and a reason, act-as is read-only and expires, EEO stays aggregate and audit ships", async ({
  page,
  accessServer,
  lokiServer,
  revealAppServer,
  revealAppUrl,
}) => {
  test.setTimeout(180_000);

  const appUrl = revealAppServer.url;
  const adminBase = `${revealAppUrl}/admin/api`;

  await openAdminAsOwner(page, revealAppUrl, accessServer.issueToken);

  await invite(page, adminBase, guestA);
  await invite(page, adminBase, guestB);

  await signInByMagicLink(page, appUrl, page.request, guestA);

  const stateA = await verifyAuthState(appUrl, page.request);
  const userA = stateA.users.find((user) => user.email === guestA);

  expect(userA).toBeDefined();

  const savedFacts = await page.request.put(`${appUrl}/api/profile/facts`, {
    data: {
      facts: [
        { key: "legal_name", value: "Alex Rivera" },
        { key: "current_job_title", value: "Support Engineer" },
        { key: "eeo_gender", value: "Woman" },
      ],
    },
  });

  expect(savedFacts.ok()).toBe(true);

  const guestBContext = await guestSession(appUrl, guestB);
  const stateB = await verifyAuthState(appUrl, guestBContext);
  const userB = stateB.users.find((user) => user.email === guestB);

  expect(userB).toBeDefined();

  if (userA === undefined || userB === undefined) {
    throw new Error("the reveal guests were not created");
  }

  const outside = await page.request.get(`${adminBase}/act-as/${userA.id}`);

  expect(outside.status()).toBe(403);
  expect(await outside.json()).toEqual({ error: "reveal_required" });

  await page.request.post(`${appUrl}/__test__/clock/offset`, {
    data: { offsetMs: PASSKEY_WINDOW_MS },
  });

  const stalePasskey = await page.request.post(`${adminBase}/users/${userA.id}/reveal`, {
    data: { reason: revealReason },
  });

  expect(stalePasskey.status()).toBe(403);
  expect(await stalePasskey.json()).toEqual({ error: "passkey_required" });

  await page.request.post(`${appUrl}/__test__/clock/offset`, { data: { offsetMs: 0 } });

  const blankReason = await page.request.post(`${adminBase}/users/${userA.id}/reveal`, {
    data: { reason: "   " },
  });

  expect(blankReason.status()).toBe(400);

  const opened = await page.request.post(`${adminBase}/users/${userA.id}/reveal`, {
    data: { reason: revealReason },
  });

  expect(opened.status()).toBe(201);

  const openedReveal = revealResponseSchema.parse(await opened.json()).reveal;

  if (openedReveal === null) {
    throw new Error("the Reveal did not open");
  }

  expect(openedReveal.targetUserId).toBe(userA.id);
  expect(openedReveal.reason).toBe(revealReason);
  expect(openedReveal.expiresAt - openedReveal.openedAt).toBe(REVEAL_MS);

  const openAudit = lokiAuditEntries(lokiServer).filter((entry) => entry.action === "reveal.open");

  expect(openAudit).toHaveLength(1);
  expect(openAudit[0]?.targetUserId).toBe(userA.id);
  expect(openAudit[0]?.reason).toBe(revealReason);
  expect(openAudit[0]?.detailKeys).toContain("expiresAt");

  const pushStreams = lokiServer.pushes.flatMap((push) => push.streams);
  const pushedLines = pushStreams.flatMap((stream) => stream.values.map(([, line]) => line));

  expect(pushStreams.length).toBeGreaterThan(0);

  for (const stream of pushStreams) {
    expect(stream.stream.job).toBe("overture-admin-audit");
    expect(stream.stream.service).toBe("overture-e2e");
  }

  expect(pushedLines.some((line) => line.includes(guestA))).toBe(false);
  expect(pushedLines.some((line) => line.includes(guestB))).toBe(false);

  const inviteAudit = lokiAuditEntries(lokiServer).filter(
    (entry) => entry.action === "invites.create",
  );

  expect(inviteAudit.length).toBeGreaterThanOrEqual(2);

  const viewResponse = await page.request.get(`${adminBase}/act-as/${userA.id}`);

  expect(viewResponse.status()).toBe(200);

  const { view } = actAsSchema.parse(await viewResponse.json());

  expect(view.user.email).toBe(guestA);
  expect(view.reveal.targetUserId).toBe(userA.id);
  expect(view.facts.some((fact) => fact.key === "legal_name")).toBe(true);
  expect(view.facts.some((fact) => fact.key.startsWith("eeo_"))).toBe(false);
  expect(view.eeoAggregates.gender.find((row) => row.value === "Woman")?.count).toBe(1);

  const readOnlyWrite = await page.request.post(`${adminBase}/act-as/${userA.id}`, {
    data: { running: true },
  });

  expect(readOnlyWrite.status()).toBe(403);
  expect(await readOnlyWrite.json()).toEqual({ error: "read_only" });

  const readOnlyBoard = await page.request.put(`${adminBase}/act-as/${userA.id}/board`, {
    data: { stage: "offer" },
  });

  expect(readOnlyBoard.status()).toBe(403);
  expect(await readOnlyBoard.json()).toEqual({ error: "read_only" });

  const crossUser = await page.request.get(`${adminBase}/act-as/${userB.id}`);

  expect(crossUser.status()).toBe(403);
  expect(await crossUser.json()).toEqual({ error: "reveal_required" });

  const crossUserReveal = await page.request.get(`${adminBase}/users/${userB.id}/reveal`);

  expect(revealResponseSchema.parse(await crossUserReveal.json()).reveal).toBeNull();

  await page.request.post(`${appUrl}/__test__/clock/offset`, {
    data: { offsetMs: REVEAL_MS + 1000 },
  });

  const expired = await page.request.get(`${adminBase}/act-as/${userA.id}`);

  expect(expired.status()).toBe(403);
  expect(await expired.json()).toEqual({ error: "reveal_required" });

  await page.request.post(`${appUrl}/__test__/clock/offset`, { data: { offsetMs: 0 } });

  const expiredAudit = lokiAuditEntries(lokiServer).filter(
    (entry) => entry.action === "reveal.expired",
  );

  expect(expiredAudit).toHaveLength(1);
  expect(expiredAudit[0]?.targetUserId).toBe(userA.id);

  const viewAudit = lokiAuditEntries(lokiServer).filter(
    (entry) => entry.action === "reveal.view" && entry.targetUserId === userA.id,
  );

  expect(viewAudit.length).toBeGreaterThanOrEqual(1);

  const { audit } = auditSchema.parse(await (await page.request.get(`${adminBase}/audit`)).json());

  const actionsForA = audit.filter((row) => row.targetUserId === userA.id).map((row) => row.action);

  expect(actionsForA).toContain("reveal.open");
  expect(actionsForA).toContain("reveal.view");
  expect(actionsForA).toContain("reveal.expired");

  const supportAccess = await page.request.get(`${appUrl}/api/support-access`);

  expect(supportAccess.status()).toBe(200);
  expect(supportAccess.headers()["cache-control"]).toBe("private, no-store");

  const entriesForA = supportAccessSchema.parse(await supportAccess.json()).entries;

  const auditIdsForA = new Set(
    audit.filter((row) => row.targetUserId === userA.id).map((row) => row.id),
  );

  expect(entriesForA.some((entry) => entry.action === "reveal.open")).toBe(true);
  expect(entriesForA.every((entry) => auditIdsForA.has(entry.id))).toBe(true);

  const supportAccessB = await guestBContext.get(`${appUrl}/api/support-access`);

  expect(supportAccessB.status()).toBe(200);
  expect(supportAccessB.headers()["cache-control"]).toBe("private, no-store");
  expect(supportAccessSchema.parse(await supportAccessB.json()).entries).toEqual([]);

  const anonymous = await apiRequest.newContext();
  const unauthenticated = await anonymous.get(`${appUrl}/api/support-access`);

  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()["cache-control"]).toBe("private, no-store");

  await anonymous.dispose();
  await guestBContext.dispose();
});
