import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { boardTargets, seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";

const fixtureToken = (...parts: string[]) => parts.join("_");
const WEBHOOK_SECRET = fixtureToken("whsec", "durable");
const SECRET_KEY = fixtureToken("sk", "test", "durable");
const CARD_SECRET = "e2e-durable-card-fingerprint-secret-0123456789";

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const consentSchema = z.object({ current: z.object({ version: z.string() }) });
const setupSchema = z.object({ url: z.url() });

const matchesSchema = z.object({
  matches: z.array(z.object({ company: z.string(), id: z.string(), title: z.string() })),
  picks: z
    .object({
      picks: z.array(
        z.object({
          company: z.string(),
          postingId: z.string(),
          status: z.string(),
          title: z.string(),
        }),
      ),
      selected: z.array(z.string()),
    })
    .optional(),
  selected: z.array(z.string()),
});

const settleSchema = z.object({
  applicationsLeft: z.number().default(0),
  outcome: z.string(),
  picks: z.object({ picks: z.array(z.object({ postingId: z.string(), status: z.string() })) }),
  prepared: z.number(),
});

const boardSchema = z.object({
  columns: z.array(
    z.object({
      cards: z.array(z.object({ company: z.string(), id: z.string(), title: z.string() })),
      stage: z.string(),
    }),
  ),
  total: z.number(),
});

const homeSchema = z.object({ applicationsLeft: z.number() });
const clockSchema = z.object({ now: z.number() });

async function startDurableHarness(identityServer: IdentityServer) {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    CARD_FINGERPRINT_SECRET: CARD_SECRET,
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_SECRET_KEY: SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  const request = await apiRequest.newContext({ baseURL: server.url });
  const { userId } = await seedOnboardingTargetsFlow(request, server.url);

  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: boardTargets });

  const upload = await request.post("/api/profile/resume", {
    multipart: {
      file: { buffer: Buffer.from(resumeBytes), mimeType: "application/pdf", name: "resume.pdf" },
    },
  });

  expect(upload.ok(), `resume upload: ${String(upload.status())}`).toBe(true);

  const consent = consentSchema.parse(await (await request.get("/api/consent")).json());

  const accepted = await request.post("/api/consent/accept", {
    data: { version: consent.current.version },
  });

  expect(accepted.ok()).toBe(true);

  return { request, server, stripe, userId };
}

async function chooseThree(request: APIRequestContext) {
  const matches = matchesSchema.parse(await (await request.get("/api/onboarding/matches")).json());
  const postingIds = matches.matches.slice(0, 3).map((match) => match.id);
  const saved = await request.put("/api/onboarding/matches", { data: { postingIds } });

  expect(saved.ok(), `saving picks: ${String(saved.status())}`).toBe(true);

  return { matches, postingIds };
}

async function setupSession(request: APIRequestContext) {
  const response = await request.post("/api/billing/trial/setup");

  expect(response.ok(), `setup session: ${String(response.status())}`).toBe(true);

  const { url } = setupSchema.parse(await response.json());
  const sessionId = /cs_(?:test|live)_[A-Za-z0-9]+/u.exec(url)?.at(0);

  expect(sessionId, `session id in ${url}`).toBeDefined();

  return sessionId ?? "";
}

async function settle(request: APIRequestContext, sessionId: string | null) {
  return request.post("/api/onboarding/settle", {
    data: sessionId === null ? {} : { sessionId },
  });
}

async function boardOf(request: APIRequestContext) {
  return boardSchema.parse(await (await request.get("/api/board")).json());
}

async function applicationsLeft(request: APIRequestContext) {
  return homeSchema.parse(await (await request.get("/api/home")).json()).applicationsLeft;
}

async function signedWebhook(request: APIRequestContext, payload: string) {
  const timestamp = Math.trunc(
    clockSchema.parse(await (await request.get("/__test__/clock")).json()).now / 1000,
  );

  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${String(timestamp)}.${payload}`)
    .digest("hex");

  return request.post("/webhooks/stripe", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${String(timestamp)},v1=${signature}`,
    },
  });
}

function setupEventPayload(eventId: string, sessionId: string, userId: string) {
  return JSON.stringify({
    data: {
      object: {
        client_reference_id: userId,
        customer: null,
        id: sessionId,
        metadata: { user_id: userId },
        mode: "setup",
        object: "checkout.session",
        status: "complete",
      },
    },
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
  });
}

test("a double return, a refresh and a repeated webhook create one Application per pick", async ({
  identityServer,
}) => {
  const harness = await startDurableHarness(identityServer);

  try {
    const { postingIds } = await chooseThree(harness.request);
    const sessionId = await setupSession(harness.request);

    harness.stripe.stubVerifiedSetupSession({
      fingerprint: "fp_durable_double_return",
      id: sessionId,
      userId: harness.userId,
    });

    const [first, second] = await Promise.all([
      settle(harness.request, sessionId),
      settle(harness.request, sessionId),
    ]);

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect(settleSchema.parse(await first.json()).outcome).toBe("prepared");
    expect(settleSchema.parse(await second.json()).outcome).toBe("prepared");

    const refreshed = await settle(harness.request, null);

    expect(refreshed.status()).toBe(200);

    const board = await boardOf(harness.request);

    expect(board.total).toBe(3);
    expect(
      new Set(board.columns.flatMap((column) => column.cards).map((card) => card.id)).size,
    ).toBe(3);
    expect(await applicationsLeft(harness.request)).toBe(3);

    const payload = setupEventPayload("evt_durable_repeat", sessionId, harness.userId);

    expect((await signedWebhook(harness.request, payload)).ok()).toBe(true);
    expect((await signedWebhook(harness.request, payload)).ok()).toBe(true);
    expect(await applicationsLeft(harness.request)).toBe(3);

    const matches = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    expect(matches.picks?.selected).toEqual(postingIds);
    expect(board.total).toBe(3);
  } finally {
    await harness.request.dispose();
    await harness.server.stop();
    await harness.stripe.stop();
  }
});

test("a cancelled or unfinished card keeps every pick", async ({ identityServer }) => {
  const harness = await startDurableHarness(identityServer);

  try {
    const { postingIds } = await chooseThree(harness.request);
    const sessionId = await setupSession(harness.request);

    harness.stripe.stubIncompleteSetupSession({ id: sessionId, userId: harness.userId });

    const pending = await settle(harness.request, sessionId);

    expect(pending.status()).toBe(202);

    const pendingBody = settleSchema.parse(await pending.json());

    expect(pendingBody.outcome).toBe("pending");
    expect(pendingBody.picks.picks).toHaveLength(3);
    expect((await boardOf(harness.request)).total).toBe(0);

    const cancelled = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    expect(cancelled.picks?.selected).toEqual(postingIds);

    harness.stripe.stubVerifiedSetupSession({
      fingerprint: "fp_durable_after_timeout",
      id: sessionId,
      userId: harness.userId,
    });

    const settled = await settle(harness.request, sessionId);

    expect(settled.status()).toBe(200);
    expect(settleSchema.parse(await settled.json()).prepared).toBe(3);
    expect((await boardOf(harness.request)).total).toBe(3);
  } finally {
    await harness.request.dispose();
    await harness.server.stop();
    await harness.stripe.stop();
  }
});

test("a posting closed during the card check keeps its employer and title on the Tracker", async ({
  identityServer,
}) => {
  const harness = await startDurableHarness(identityServer);

  try {
    const { matches, postingIds } = await chooseThree(harness.request);
    const sessionId = await setupSession(harness.request);

    harness.stripe.stubVerifiedSetupSession({
      fingerprint: "fp_durable_closed_posting",
      id: sessionId,
      userId: harness.userId,
    });

    const closing = matches.matches.at(0);

    expect(closing).toBeDefined();

    const closed = await harness.request.post("/__test__/catalog/postings/close", {
      data: { id: postingIds.at(0) },
    });

    expect(closed.ok()).toBe(true);

    const settled = await settle(harness.request, sessionId);

    expect(settled.status()).toBe(200);
    expect(settleSchema.parse(await settled.json()).prepared).toBe(2);

    const board = await boardOf(harness.request);
    const cards = board.columns.flatMap((column) => column.cards);
    const surviving = cards.find((card) => card.title === closing?.title);

    expect(board.total).toBe(3);
    expect(surviving?.company).toBe(closing?.company);

    const matchesAfter = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    const closedPick = matchesAfter.picks?.picks.find(
      (pick) => pick.postingId === postingIds.at(0),
    );

    expect(closedPick?.status).toBe("closed");
  } finally {
    await harness.request.dispose();
    await harness.server.stop();
    await harness.stripe.stop();
  }
});

test("an account whose card already funded a trial keeps its picks and gets a distinct outcome", async ({
  identityServer,
}) => {
  const harness = await startDurableHarness(identityServer);

  try {
    const { postingIds } = await chooseThree(harness.request);

    await harness.request.post("/__test__/ledger/grant", {
      data: {
        email: authTestIdentity.ownerEmail,
        idempotencyKey: "durable-already-trialed",
        quantity: 3,
        source: "trial",
      },
    });

    await Promise.all(
      postingIds.map(async (_postingId, index) => {
        await harness.request.post("/__test__/ledger/application", {
          data: {
            applicationId: `consumed-${String(index)}`,
            commit: true,
            email: authTestIdentity.ownerEmail,
          },
        });
      }),
    );

    expect(await applicationsLeft(harness.request)).toBe(0);

    const sessionId = await setupSession(harness.request);

    harness.stripe.stubVerifiedSetupSession({
      fingerprint: "fp_durable_other_card",
      id: sessionId,
      userId: harness.userId,
    });

    const settled = await settle(harness.request, sessionId);

    expect(settled.status()).toBe(409);
    expect(settleSchema.parse(await settled.json()).outcome).toBe("already_trialed");

    const matches = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    expect(matches.picks?.selected).toEqual(postingIds);
    expect((await boardOf(harness.request)).total).toBe(0);
  } finally {
    await harness.request.dispose();
    await harness.server.stop();
    await harness.stripe.stop();
  }
});
