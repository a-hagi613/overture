import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";
import { dkimSign } from "mailauth";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startTxtDnsServer } from "./dns.fixture.ts";
import { INBOUND_HEADERS, signInbound } from "./inbound-mail.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const SECRET = "e2e-calendar-secret-0123456789";
const SELECTOR = "overture";
const SIGNING_DOMAIN = "us.greenhouse-mail.io";

const SERVER_NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;

const SENT_AT = Date.UTC(2026, 10, 19, 15, 0, 0);

interface MailHarness {
  server: AppServer;
  sign: (raw: string) => Promise<string>;
}

const test = appTest.extend<{ mail: MailHarness }>({
  mail: [
    async ({ identityServer }, provide) => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

      const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
      const publicDer = publicKey.export({ format: "der", type: "spki" });
      const record = `v=DKIM1; k=rsa; p=${Buffer.from(publicDer).toString("base64")}`;

      const dns = await startTxtDnsServer({
        [`${SELECTOR}._domainkey.${SIGNING_DOMAIN}`]: [record],
      });

      const server = await startFreshAppServer(identityServer, {
        INBOUND_DNS_SERVER: dns.server,
        INBOUND_HMAC_SECRET: SECRET,
        MAIL_DOMAIN: "tryoverture.com",
      });

      await provide({
        server,
        sign: async (raw) => {
          const result = await dkimSign(raw, {
            signatureData: [
              { privateKey: privateKeyPem, selector: SELECTOR, signingDomain: SIGNING_DOMAIN },
            ],
            signTime: new Date(SENT_AT),
          });

          if (result.errors.length > 0) {
            throw new Error(result.errors.map((error) => error.err.message).join("; "));
          }

          return `${result.signatures}${raw}`;
        },
      });

      await server.stop();
      await dns.stop();
    },
    { scope: "test" },
  ],
});

const calendarSchema = z
  .object({
    items: z.array(
      z
        .object({
          applicationId: z.string(),
          at: z.number(),
          closedReason: z.string().nullable(),
          company: z.string(),
          id: z.string(),
          kind: z.enum(["sent", "stage", "checkin", "interview"]),
          source: z.enum(["system", "user", "email", "checkin", "admin"]).nullable(),
          stage: z.enum(["applied", "screening", "interviewing", "offer", "closed"]).nullable(),
          title: z.string(),
        })
        .strict(),
    ),
    timeZone: z.string(),
  })
  .strict();

const mailboxSchema = z.object({ address: z.string() });

const homeSchema = z.object({
  checkIns: z.array(z.object({ applicationId: z.string(), dueAt: z.number(), id: z.string() })),
});

const jobsSchema = z.object({
  jobs: z.array(z.object({ kind: z.string(), status: z.string() })),
});

const createdSchema = z.object({ id: z.string() });

function iso(at: number) {
  return new Date(at).toISOString();
}

function fixture(name: string) {
  return readFileSync(join(process.cwd(), "test/e2e/fixtures/mail", name), "utf8");
}

function fresh(raw: string) {
  return raw
    .replaceAll("__MESSAGE_ID__", crypto.randomUUID())
    .replaceAll("__ACK_ID__", crypto.randomUUID());
}

async function moveClockTo(request: APIRequestContext, target: number) {
  const current = z
    .object({ now: z.number(), offsetMs: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  const moved = await request.post("/__test__/clock/offset", {
    data: { offsetMs: target - current.now + current.offsetMs },
  });

  expect(moved.ok()).toBe(true);
}

async function calendarOf(request: APIRequestContext, from: number, to: number) {
  const response = await request.get(
    `/api/calendar?from=${encodeURIComponent(iso(from))}&to=${encodeURIComponent(iso(to))}`,
  );

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");

  return calendarSchema.parse(await response.json());
}

async function mailboxAddress(owner: APIRequestContext) {
  return mailboxSchema.parse(await (await owner.get("/api/profile/mailbox")).json()).address;
}

async function forward(mail: MailHarness, owner: APIRequestContext, raw: string, address: string) {
  const body = new TextEncoder().encode(await mail.sign(raw));

  const timestamp = Math.trunc(
    z.object({ now: z.number() }).parse(await (await owner.get("/__test__/clock")).json()).now /
      1000,
  );

  const signed = await signInbound(SECRET, { body, rcptTo: address, timestamp });

  const response = await owner.post("/internal/mail/inbound", {
    data: Buffer.from(body),
    headers: {
      [INBOUND_HEADERS.mailFrom]: "owner@forwarder.test",
      [INBOUND_HEADERS.rcptTo]: address,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      "content-type": "message/rfc822",
    },
  });

  expect(response.status()).toBe(204);
}

async function runMailJobs(owner: APIRequestContext) {
  const response = await owner.post("/__test__/jobs/run-due");

  expect(response.ok()).toBe(true);
  await expect
    .poll(
      async () => {
        const { jobs } = jobsSchema.parse(await (await owner.get("/__test__/jobs")).json());

        return jobs.filter(
          (job) =>
            (job.kind === "mail.ingest" || job.kind === "mail.classify") &&
            (job.status === "queued" || job.status === "running"),
        ).length;
      },
      { timeout: 30_000 },
    )
    .toBe(0);
}

async function runJob(owner: APIRequestContext, kind: string) {
  const response = await owner.post("/__test__/jobs/run-now", {
    data: { kind, payload: "{}" },
  });

  expect(response.ok()).toBe(true);
}

async function seededApplication(
  owner: APIRequestContext,
  userId: string,
  input: { atsJobId: string; sentAt: number | null; status: "ready" | "sent" },
) {
  const companyId = await seedCompany(owner, "Acme", "acme.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", input.atsJobId);

  const postingId = await seedPosting(owner, {
    atsJobId: input.atsJobId,
    boardId,
    companyId,
    title: "Senior Backend Engineer",
    url: `https://acme.example/${input.atsJobId}`,
  });

  return seedApplication(owner, {
    postingId,
    sentAt: input.sentAt,
    status: input.status,
    userId,
  });
}

test("the Calendar shows a sent Application and the Stage moves its recorded mail makes", async ({
  mail,
}) => {
  const { owner, userId } = await ownerContextFor(mail.server.url);

  await moveClockTo(owner, SERVER_NOW);

  const applicationId = await seededApplication(owner, userId, {
    atsJobId: "calendar-mail",
    sentAt: SENT_AT,
    status: "sent",
  });

  const address = await mailboxAddress(owner);

  await forward(mail, owner, fresh(fixture("greenhouse-interview.eml")), address);
  await runMailJobs(owner);

  await moveClockTo(owner, SERVER_NOW + HOUR);

  await forward(mail, owner, fresh(fixture("greenhouse-rejection.eml")), address);
  await runMailJobs(owner);

  const queuedApplicationId = await seededApplication(owner, userId, {
    atsJobId: "calendar-queued",
    sentAt: null,
    status: "ready",
  });

  const queued = await owner.patch(
    `/api/applications/${encodeURIComponent(queuedApplicationId)}/stage`,
    {
      data: { position: null, stage: "queued" },
    },
  );

  expect(queued.ok()).toBe(true);

  const week = await calendarOf(owner, Date.UTC(2026, 10, 18), Date.UTC(2026, 10, 22));

  expect(week.timeZone).toBe("UTC");
  expect(week.items.map((item) => item.id)).toEqual([
    `sent:${applicationId}`,
    expect.stringMatching(/^stage:/u),
    expect.stringMatching(/^stage:/u),
  ]);
  expect(week.items.map((item) => item.applicationId)).not.toContain(queuedApplicationId);

  const [sentItem, interviewItem, rejectionItem] = week.items;

  expect(sentItem).toEqual({
    applicationId,
    at: SENT_AT,
    closedReason: null,
    company: "Acme",
    id: `sent:${applicationId}`,
    kind: "sent",
    source: null,
    stage: "applied",
    title: "Senior Backend Engineer",
  });
  expect(week.items.slice(1).map(({ at: _at, id: _id, ...item }) => item)).toEqual([
    {
      applicationId,
      closedReason: null,
      company: "Acme",
      kind: "stage",
      source: "email",
      stage: "interviewing",
      title: "Senior Backend Engineer",
    },
    {
      applicationId,
      closedReason: "rejected",
      company: "Acme",
      kind: "stage",
      source: "email",
      stage: "closed",
      title: "Senior Backend Engineer",
    },
  ]);
  expect(interviewItem?.at).toBeGreaterThanOrEqual(SERVER_NOW);
  expect(interviewItem?.at).toBeLessThan(SERVER_NOW + HOUR);
  expect(rejectionItem?.at).toBeGreaterThanOrEqual(SERVER_NOW + HOUR);

  const later = await calendarOf(owner, Date.UTC(2026, 10, 22), Date.UTC(2026, 10, 24));

  expect(later.items).toEqual([]);

  await owner.dispose();
});

test("the Calendar shows a Check-in on its due day and the day it is answered", async ({
  mail,
}) => {
  const { owner, userId } = await ownerContextFor(mail.server.url);

  await moveClockTo(owner, SERVER_NOW);

  const applicationId = await seededApplication(owner, userId, {
    atsJobId: "calendar-checkin",
    sentAt: SERVER_NOW - 22 * DAY,
    status: "sent",
  });

  await runJob(owner, "checkin.sweep");

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());
  const checkin = home.checkIns.find((row) => row.applicationId === applicationId);

  if (checkin === undefined) {
    throw new Error("the sweep did not open a Check-in for the seeded Application");
  }

  expect(checkin.dueAt).toBe(SERVER_NOW - DAY);

  const dueDay = await calendarOf(owner, SERVER_NOW - 2 * DAY, SERVER_NOW);

  expect(dueDay.items).toEqual([
    {
      applicationId,
      at: checkin.dueAt,
      closedReason: null,
      company: "Acme",
      id: `checkin:${checkin.id}`,
      kind: "checkin",
      source: null,
      stage: "applied",
      title: "Senior Backend Engineer",
    },
  ]);

  await moveClockTo(owner, SERVER_NOW + HOUR);

  const answered = await owner.post(`/api/checkins/${encodeURIComponent(checkin.id)}`, {
    data: { answer: "rejected" },
  });

  expect(answered.ok()).toBe(true);

  const answerDay = await calendarOf(owner, SERVER_NOW, SERVER_NOW + DAY);

  expect(answerDay.items.map((item) => [item.kind, item.stage, item.source])).toEqual([
    ["checkin", "closed", "user"],
    ["stage", "closed", "checkin"],
  ]);
  expect(answerDay.items.map((item) => item.closedReason)).toEqual(["rejected", "rejected"]);

  for (const item of answerDay.items) {
    expect(item.at).toBeGreaterThanOrEqual(SERVER_NOW + HOUR);
  }

  await owner.dispose();
});

test("the Calendar refuses a window over 42 days and never shows another user's Applications", async ({
  mail,
}) => {
  const { owner, userId } = await ownerContextFor(mail.server.url);

  await moveClockTo(owner, SERVER_NOW);

  const companyId = await seedCompany(owner, "Acme", "acme.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "calendar-scope");

  const postingId = await seedPosting(owner, {
    atsJobId: "calendar-scope",
    boardId,
    companyId,
    title: "Senior Backend Engineer",
    url: "https://acme.example/calendar-scope",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    sentAt: SENT_AT,
    status: "sent",
    userId,
  });

  const otherUserId = createdSchema.parse(
    await (
      await owner.post("/__test__/users", {
        data: { email: "someone.else@example.com", name: "Someone Else" },
      })
    ).json(),
  ).id;

  const otherApplicationId = await seedApplication(owner, {
    postingId,
    sentAt: SENT_AT,
    status: "sent",
    userId: otherUserId,
  });

  const mine = await calendarOf(owner, Date.UTC(2026, 10, 18), Date.UTC(2026, 10, 22));

  expect(mine.items.map((item) => item.applicationId)).toEqual([applicationId]);
  expect(mine.items.map((item) => item.applicationId)).not.toContain(otherApplicationId);

  const anonymous = await apiRequest.newContext({ baseURL: mail.server.url });

  const refused = await anonymous.get(
    `/api/calendar?from=${encodeURIComponent(iso(Date.UTC(2026, 10, 18)))}&to=${encodeURIComponent(iso(Date.UTC(2026, 10, 22)))}`,
  );

  expect(refused.status()).toBe(401);

  const refusedWithoutQuery = await anonymous.get("/api/calendar");

  expect(refusedWithoutQuery.status()).toBe(401);

  const fortyTwoDays = await owner.get(
    `/api/calendar?from=${encodeURIComponent(iso(Date.UTC(2026, 10, 1)))}&to=${encodeURIComponent(iso(Date.UTC(2026, 11, 13)))}`,
  );

  expect(fortyTwoDays.status()).toBe(200);

  const fortyThreeDays = await owner.get(
    `/api/calendar?from=${encodeURIComponent(iso(Date.UTC(2026, 10, 1)))}&to=${encodeURIComponent(iso(Date.UTC(2026, 11, 14)))}`,
  );

  expect(fortyThreeDays.status()).toBe(400);

  const reversed = await owner.get(
    `/api/calendar?from=${encodeURIComponent(iso(Date.UTC(2026, 10, 22)))}&to=${encodeURIComponent(iso(Date.UTC(2026, 10, 18)))}`,
  );

  expect(reversed.status()).toBe(400);

  const missing = await owner.get("/api/calendar");

  expect(missing.status()).toBe(400);

  await anonymous.dispose();
  await owner.dispose();
});
