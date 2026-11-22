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
import { decodePush, subscriptionKeys, vapidKeyPair } from "./push.fixture.ts";
import type { SubscriptionKeys } from "./push.fixture.ts";

const vapid = vapidKeyPair();
const SECRET = "e2e-flow-28-secret-0123456789abc";
const SELECTOR = "overture";
const SIGNING_DOMAINS = ["us.greenhouse-mail.io", "acme.example"] as const;

type SigningDomain = (typeof SIGNING_DOMAINS)[number];

interface NotifyHarness {
  server: AppServer;
  sign: (raw: string, domain: SigningDomain) => Promise<string>;
}

const test = appTest.extend<{ notify: NotifyHarness }>({
  notify: [
    async ({ identityServer }, provide) => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

      const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
      const publicDer = publicKey.export({ format: "der", type: "spki" });
      const record = `v=DKIM1; k=rsa; p=${Buffer.from(publicDer).toString("base64")}`;

      const dns = await startTxtDnsServer(
        Object.fromEntries(
          SIGNING_DOMAINS.map((domain) => [`${SELECTOR}._domainkey.${domain}`, [record]]),
        ),
      );

      const server = await startFreshAppServer(identityServer, {
        INBOUND_DNS_SERVER: dns.server,
        INBOUND_HMAC_SECRET: SECRET,
        MAIL_DOMAIN: "tryoverture.com",
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_PUBLIC_KEY: vapid.publicKey,
      });

      await provide({
        server,
        sign: async (raw, domain) => {
          const result = await dkimSign(raw, {
            signatureData: [
              { privateKey: privateKeyPem, selector: SELECTOR, signingDomain: domain },
            ],
            signTime: new Date("2026-11-19T15:00:00Z"),
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

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });

const notificationSchema = z.object({
  body: z.string(),
  createdAt: z.number(),
  emailedAt: z.number().nullable(),
  id: z.string(),
  kind: z.string(),
  pushedAt: z.number().nullable(),
  title: z.string(),
  url: z.string(),
});

const notificationsSchema = z.object({ notifications: z.array(notificationSchema) });

const pushRequestsSchema = z.object({
  requests: z.array(z.object({ body: z.string(), method: z.string(), url: z.string() })),
});

const mailSchema = z.object({
  messages: z.array(
    z.object({
      body: z.string(),
      html: z.string().optional(),
      subject: z.string(),
      to: z.string(),
    }),
  ),
});

const preferencesSchema = z.object({
  preferences: z.object({
    code_wait: z.boolean(),
    failed: z.boolean(),
    interview: z.boolean(),
    offer: z.boolean(),
    paused: z.boolean(),
    ready: z.boolean(),
    recap_email: z.boolean(),
    reply: z.boolean(),
    review: z.boolean(),
    stage_move: z.boolean(),
  }),
});

const readySchema = z.object({ approved: z.number(), ready: z.number() });

const jobsSchema = z.object({
  jobs: z.array(
    z.object({ id: z.string(), kind: z.string(), runAt: z.number(), status: z.string() }),
  ),
});

const boardSchema = z.object({
  columns: z.array(z.object({ cards: z.array(z.object({ id: z.string() })) })),
});

const mailboxSchema = z.object({ address: z.string() });

async function moveClockTo(owner: APIRequestContext, at: number) {
  const { now, offsetMs } = clockSchema.parse(await (await owner.get("/__test__/clock")).json());

  await owner.post("/__test__/clock/offset", { data: { offsetMs: at - (now - offsetMs) } });
}

async function notificationsFor(owner: APIRequestContext, userId: string) {
  return notificationsSchema.parse(
    await (await owner.get(`/__test__/notifications?userId=${encodeURIComponent(userId)}`)).json(),
  ).notifications;
}

async function notificationsOfKind(owner: APIRequestContext, userId: string, kind: string) {
  return (await notificationsFor(owner, userId)).filter((row) => row.kind === kind);
}

async function jobsOfKind(owner: APIRequestContext, kind: string) {
  const { jobs } = jobsSchema.parse(await (await owner.get("/__test__/jobs")).json());

  return jobs.filter((job) => job.kind === kind);
}

async function pushRequests(owner: APIRequestContext) {
  return pushRequestsSchema.parse(await (await owner.get("/__test__/push/requests")).json())
    .requests;
}

async function pushedTitles(owner: APIRequestContext, keys: SubscriptionKeys) {
  const requests = await pushRequests(owner);

  return requests.map((entry) => decodePush(entry.body, keys).title);
}

async function waitForPushTitle(owner: APIRequestContext, keys: SubscriptionKeys, title: string) {
  await expect.poll(async () => pushedTitles(owner, keys), { timeout: 20_000 }).toContain(title);
}

async function waitForNotification(
  owner: APIRequestContext,
  userId: string,
  kind: string,
  title: string,
) {
  await expect
    .poll(
      async () =>
        (await notificationsOfKind(owner, userId, kind)).map((notification) => notification.title),
      { timeout: 20_000 },
    )
    .toContain(title);
}

async function subscribe(owner: APIRequestContext, endpoint: string) {
  const keys = subscriptionKeys();

  const response = await owner.post("/api/push/subscribe", {
    data: { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } },
  });

  expect(response.ok()).toBe(true);

  return keys;
}

function mailFixture(name: string, company?: string) {
  const raw = readFileSync(join(process.cwd(), "test/e2e/fixtures/mail", name), "utf8")
    .replaceAll("__MESSAGE_ID__", crypto.randomUUID())
    .replaceAll("__ACK_ID__", crypto.randomUUID());

  return company === undefined ? raw : raw.replaceAll("Acme", company);
}

async function forward(
  harness: NotifyHarness,
  owner: APIRequestContext,
  raw: string,
  address: string,
  domain: SigningDomain,
) {
  const body = new TextEncoder().encode(await harness.sign(raw, domain));

  const timestamp = Math.trunc(
    clockSchema.parse(await (await owner.get("/__test__/clock")).json()).now / 1000,
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

async function mailboxAddress(owner: APIRequestContext) {
  return mailboxSchema.parse(await (await owner.get("/api/profile/mailbox")).json()).address;
}

async function runMailJobs(owner: APIRequestContext) {
  expect((await owner.post("/__test__/jobs/run-due")).ok()).toBe(true);

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

async function mailFor(owner: APIRequestContext) {
  return mailSchema.parse(await (await owner.get("/__test__/mail")).json()).messages;
}

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", {
    data: { kind, payload },
  });

  expect(response.ok()).toBe(true);
}

interface JobPosting {
  company: string;
  domain: string;
  title: string;
}

async function seedPostingFor(owner: APIRequestContext, input: JobPosting) {
  const companyId = await seedCompany(owner, input.company, input.domain);
  const slug = `${input.domain}-${input.title}`.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
  const boardId = await seedBoard(owner, companyId, "greenhouse", slug);

  return seedPosting(owner, {
    atsJobId: `${slug}-job`,
    boardId,
    companyId,
    title: input.title,
    url: `https://${input.domain}/${slug}`,
  });
}

async function seedSentApplication(
  owner: APIRequestContext,
  input: JobPosting & { userId: string; sentAt: number },
) {
  const postingId = await seedPostingFor(owner, input);

  return seedApplication(owner, {
    postingId,
    sentAt: input.sentAt,
    status: "sent",
    userId: input.userId,
  });
}

async function seedReadyApplication(
  owner: APIRequestContext,
  input: JobPosting & { userId: string; readyAt: number },
) {
  const postingId = await seedPostingFor(owner, input);

  return seedApplication(owner, {
    postingId,
    readyAt: input.readyAt,
    status: "ready",
    userId: input.userId,
  });
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

const AT = Date.UTC(2026, 10, 18, 9, 0, 0);

test("each event writes one list row and one push, and no push approves anything", async ({
  notify,
}) => {
  const { owner, userId } = await ownerContextFor(notify.server.url);
  const keys = await subscribe(owner, "https://push.example.test/send/flow-28");

  await owner.post("/__test__/mail/clear", { data: {} });
  await owner.put("/api/profile/settings", { data: { languages: ["en"], timezone: "UTC" } });
  await moveClockTo(owner, AT);

  const acme = await seedSentApplication(owner, {
    company: "Acme",
    domain: "acme.example",
    sentAt: AT - 60 * 60_000,
    title: "Senior Backend Engineer",
    userId,
  });

  await owner.post("/__test__/reviews/open", {
    data: {
      applicationIds: [acme],
      fieldType: "text",
      prompt: "What is/was your GPA?",
      reason: "unknown_required",
      scope: "",
      userId,
    },
  });

  await waitForNotification(owner, userId, "review", "A question for you");
  await waitForPushTitle(owner, keys, "A question for you");

  const address = await mailboxAddress(owner);

  await forward(notify, owner, mailFixture("acme-reply.eml"), address, "acme.example");
  await runMailJobs(owner);

  await waitForNotification(owner, userId, "reply", "Acme replied");
  await waitForPushTitle(owner, keys, "Acme replied");

  await forward(
    notify,
    owner,
    mailFixture("greenhouse-interview.eml"),
    address,
    "us.greenhouse-mail.io",
  );
  await runMailJobs(owner);

  await waitForNotification(owner, userId, "interview", "Interview request: Acme");
  await waitForPushTitle(owner, keys, "Interview request: Acme");

  await forward(
    notify,
    owner,
    mailFixture("greenhouse-offer.eml"),
    address,
    "us.greenhouse-mail.io",
  );
  await runMailJobs(owner);

  await waitForNotification(owner, userId, "offer", "Offer from Acme");
  await waitForPushTitle(owner, keys, "Offer from Acme");

  const larkspur = await seedSentApplication(owner, {
    company: "Larkspur",
    domain: "larkspur.example",
    sentAt: AT - 2 * 60 * 60_000,
    title: "Staff Platform Engineer",
    userId,
  });

  await forward(
    notify,
    owner,
    mailFixture("greenhouse-rejection.eml", "Larkspur"),
    address,
    "us.greenhouse-mail.io",
  );
  await runMailJobs(owner);

  await waitForNotification(owner, userId, "stage_move", "Moved to Closed");
  await waitForPushTitle(owner, keys, "Moved to Closed");

  const moved = (await notificationsOfKind(owner, userId, "stage_move")).find(
    (notification) => notification.title === "Moved to Closed",
  );

  expect(moved?.url).toContain(`undo=${larkspur}`);

  await owner.post("/api/running", { data: { running: false } });
  await waitForNotification(owner, userId, "paused", "Paused by you.");
  await waitForPushTitle(owner, keys, "Paused by you.");

  const reviewRows = await notificationsOfKind(owner, userId, "review");
  const replyRows = await notificationsOfKind(owner, userId, "reply");
  const interviewRows = await notificationsOfKind(owner, userId, "interview");
  const offerRows = await notificationsOfKind(owner, userId, "offer");

  expect(reviewRows).toHaveLength(1);
  expect(replyRows).toHaveLength(1);
  expect(interviewRows).toHaveLength(1);
  expect(offerRows).toHaveLength(1);
  expect(replyRows[0]?.url).toBe("/inbox");
  expect(interviewRows[0]?.url).toBe("/inbox");
  expect(offerRows[0]?.url).toBe("/inbox");
  expect(readySchema.parse(await (await owner.get("/api/ready")).json()).approved).toBe(0);

  const board = boardSchema.parse(await (await owner.get("/api/board")).json());

  expect(board.columns.flatMap((column) => column.cards).map((card) => card.id)).toContain(acme);
  expect((await jobsOfKind(owner, "application.send")).length).toBe(0);

  await owner.dispose();
});

test("Couldn't apply failures batch into one row and one push an hour", async ({ notify }) => {
  const { owner, userId } = await ownerContextFor(notify.server.url);

  await moveClockTo(owner, Date.UTC(2026, 10, 18, 15, 10, 0));

  const first = await seedSentApplication(owner, {
    company: "Halden Systems",
    domain: "halden.example",
    sentAt: AT,
    title: "Site Reliability Engineer",
    userId,
  });

  const second = await seedSentApplication(owner, {
    company: "Northwind Labs",
    domain: "northwind.example",
    sentAt: AT,
    title: "Platform Engineer",
    userId,
  });

  await owner.post("/__test__/applications/status", {
    data: { applicationId: first, status: "failed", statusReason: "fill_failed" },
  });
  await owner.post("/__test__/applications/status", {
    data: { applicationId: second, status: "failed", statusReason: "upload_failed" },
  });
  await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId: first,
      events: [
        {
          at: Date.UTC(2026, 10, 18, 14, 5, 0),
          kind: "status",
          source: "system",
          toValue: "failed",
        },
      ],
    },
  });
  await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId: second,
      events: [
        {
          at: Date.UTC(2026, 10, 18, 14, 50, 0),
          kind: "status",
          source: "system",
          toValue: "failed",
        },
      ],
    },
  });

  await owner.post("/__test__/push/clear", { data: {} });
  await runJob(owner, "notify.apply_failures", "{}");

  await waitForNotification(owner, userId, "failed", "Couldn't apply to 2 applications");

  const rows = await notificationsOfKind(owner, userId, "failed");

  expect(rows).toHaveLength(1);
  expect(rows[0]?.body).toContain("Between 14:00 and 15:00");

  await runJob(owner, "notify.apply_failures", "{}");

  expect(await notificationsOfKind(owner, userId, "failed")).toHaveLength(1);

  await moveClockTo(owner, Date.UTC(2026, 10, 18, 16, 10, 0));
  await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId: first,
      events: [
        {
          at: Date.UTC(2026, 10, 18, 15, 20, 0),
          kind: "status",
          source: "system",
          toValue: "failed",
        },
      ],
    },
  });

  await runJob(owner, "notify.apply_failures", "{}");

  await waitForNotification(owner, userId, "failed", "Couldn't apply to 1 application");

  expect(await notificationsOfKind(owner, userId, "failed")).toHaveLength(2);

  await owner.dispose();
});

test("the hourly failure pass stays on the hour boundary, so a run at HH:59 skips no hour", async ({
  notify,
}) => {
  const { owner, userId } = await ownerContextFor(notify.server.url);

  const endOfHour = Date.UTC(2026, 10, 20, 15, 59, 58);

  await moveClockTo(owner, endOfHour);

  const beforeBoundary = await seedSentApplication(owner, {
    company: "Fenwick & Marsh",
    domain: "fenwick.example",
    sentAt: endOfHour,
    title: "Data Engineer",
    userId,
  });

  const afterBoundary = await seedSentApplication(owner, {
    company: "Quillon Payments",
    domain: "quillon.example",
    sentAt: endOfHour,
    title: "Payments Engineer",
    userId,
  });

  await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId: beforeBoundary,
      events: [
        {
          at: Date.UTC(2026, 10, 20, 14, 30, 0),
          kind: "status",
          source: "system",
          toValue: "failed",
        },
      ],
    },
  });
  await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId: afterBoundary,
      events: [
        {
          at: Date.UTC(2026, 10, 20, 15, 20, 0),
          kind: "status",
          source: "system",
          toValue: "failed",
        },
      ],
    },
  });

  await runJob(owner, "notify.apply_failures", "{}");

  await waitForNotification(owner, userId, "failed", "Couldn't apply to 1 application");

  const boundary = Date.UTC(2026, 10, 20, 16, 0, 0);

  await moveClockTo(owner, boundary + 20_000);
  expect((await owner.post("/__test__/jobs/run-due")).ok()).toBe(true);

  await waitForNotification(owner, userId, "failed", "Couldn't apply to 1 application");

  const rows = await notificationsOfKind(owner, userId, "failed");

  expect(rows).toHaveLength(2);

  const next = (await jobsOfKind(owner, "notify.apply_failures")).filter(
    (job) => job.status === "queued",
  );

  const nextRunAt = boundary + 60 * 60_000 + 5000;

  expect(next.some((job) => job.runAt === nextRunAt)).toBe(true);

  await owner.dispose();
});

test("a boot inside the boundary margin leaves a pinned pass alone and the ended hour still digests", async ({
  notify,
}) => {
  const { owner, userId } = await ownerContextFor(notify.server.url);

  const hourEnd = Date.UTC(2026, 10, 21, 10, 0, 0);

  await moveClockTo(owner, hourEnd + 10_000);

  const atStart = await seedSentApplication(owner, {
    company: "Brightwave Analytics",
    domain: "brightwave.example",
    sentAt: hourEnd,
    title: "Analytics Engineer",
    userId,
  });

  const atEnd = await seedSentApplication(owner, {
    company: "Larkspur Health",
    domain: "larkspur.example",
    sentAt: hourEnd,
    title: "Health Data Engineer",
    userId,
  });

  await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId: atStart,
      events: [
        {
          at: hourEnd,
          kind: "status",
          source: "system",
          toValue: "failed",
        },
      ],
    },
  });
  await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId: atEnd,
      events: [
        {
          at: hourEnd + 60 * 60_000,
          kind: "status",
          source: "system",
          toValue: "failed",
        },
      ],
    },
  });

  await runJob(owner, "notify.apply_failures", "{}");

  const pinnedRunAt = hourEnd + 60 * 60_000 + 5000;

  const queuedPass = async () =>
    (await jobsOfKind(owner, "notify.apply_failures")).find(
      (job) => job.status === "queued" && job.runAt === pinnedRunAt,
    );

  expect(await queuedPass()).toBeDefined();

  await moveClockTo(owner, hourEnd + 60 * 60_000 + 2000);
  expect((await owner.post("/__test__/notify/apply-failures/ensure")).ok()).toBe(true);
  expect(await queuedPass()).toBeDefined();

  await moveClockTo(owner, hourEnd + 60 * 60_000 + 10_000);
  expect((await owner.post("/__test__/jobs/run-due")).ok()).toBe(true);

  await waitForNotification(owner, userId, "failed", "Couldn't apply to 1 application");

  const rows = await notificationsOfKind(owner, userId, "failed");

  expect(rows).toHaveLength(1);
  expect(rows[0]?.body).toContain("Between 10:00 and 11:00");

  await owner.dispose();
});

test("the recap sends one push and one email per run, lists yesterday's sends and replies, and respects the email switch", async ({
  notify,
}) => {
  const { owner, userId } = await ownerContextFor(notify.server.url);
  const keys = await subscribe(owner, "https://push.example.test/send/recap");

  await owner.post("/__test__/mail/clear", { data: {} });
  await owner.put("/api/profile/settings", { data: { languages: ["en"], timezone: "UTC" } });

  const runAt = Date.UTC(2026, 10, 19, 7, 10, 0);

  await moveClockTo(owner, runAt);

  const ready = await seedReadyApplication(owner, {
    company: "Recap & Direct",
    domain: "recap-direct.example",
    readyAt: runAt,
    title: "Staff Platform Engineer",
    userId,
  });

  const sentYesterday = await seedSentApplication(owner, {
    company: "Northwind Labs",
    domain: "northwind.example",
    sentAt: runAt - 19 * 60 * 60_000,
    title: "Platform Engineer",
    userId,
  });

  const receipted = await seedSentApplication(owner, {
    company: "Halden Systems",
    domain: "halden.example",
    sentAt: runAt - 20 * 60 * 60_000,
    title: "Site Reliability Engineer",
    userId,
  });

  await owner.post("/__test__/mail/seed", {
    data: {
      applicationId: sentYesterday,
      at: runAt - 18 * 60 * 60_000,
      auth: "pass",
      classification: "other",
      direction: "in",
      from: "Talent <talent@northwind.example>",
      senderDomain: "northwind.example",
      subject: "A quick note",
      text: "Thanks for your note. The team will write again soon.",
      userId,
    },
  });

  await Promise.all(
    (["ack", "code"] as const).map(async (classification) =>
      owner.post("/__test__/mail/seed", {
        data: {
          applicationId: receipted,
          at: runAt - 17 * 60 * 60_000,
          auth: "pass",
          classification,
          direction: "in",
          from: "Greenhouse <no-reply@us.greenhouse-mail.io>",
          senderDomain: "us.greenhouse-mail.io",
          subject: classification === "ack" ? "We received your application" : "Your code",
          text: classification === "ack" ? "Thank you for applying to Halden Systems." : "12345678",
          userId,
        },
      }),
    ),
  );
  await owner.post("/__test__/reviews/open", {
    data: {
      applicationIds: [ready],
      fieldType: "select",
      options: ["Yes", "No"],
      prompt: "Are you authorised to work in Canada?",
      reason: "unknown_required",
      scope: "CA",
      userId,
    },
  });

  await runJob(owner, "ready.notify", JSON.stringify({ since: runAt - 60_000, userId }));

  await expect.poll(async () => (await mailFor(owner)).length, { timeout: 20_000 }).toBe(1);

  const [recap] = await mailFor(owner);

  expect(recap?.subject).toBe("Overture recap: 1 ready to approve, 1 need an answer");
  expect(recap?.body).toContain("Staff Platform Engineer at Recap & Direct");
  expect(recap?.body).toContain("Sent yesterday:");
  expect(recap?.body).toContain("Platform Engineer at Northwind Labs");
  expect(recap?.body).toContain("1 employer replied yesterday:");
  expect(recap?.body).toContain("- Northwind Labs");
  expect(recap?.body).not.toContain("- Halden Systems");
  expect(recap?.html).toContain("<!doctype html>");
  expect(recap?.html).toContain("Staff Platform Engineer at Recap &amp; Direct");
  expect(recap?.html).not.toContain("Recap & Direct");
  expect(recap?.html).toContain("1 employer replied yesterday");
  expect(recap?.html).toMatch(/href="[^"]+\/ready"/u);
  expect(recap?.html).toContain("@media (prefers-color-scheme: dark)");
  expect(recap?.body).toContain("Site Reliability Engineer at Halden Systems");
  expect(recap?.body.match(/\/ready/gu)).toHaveLength(1);

  const recapRows = await notificationsOfKind(owner, userId, "ready");

  expect(recapRows).toHaveLength(1);
  expect(recapRows[0]?.url).toContain("/ready");
  expect(recapRows[0]?.emailedAt).not.toBeNull();

  await waitForPushTitle(owner, keys, recap?.subject ?? "");

  await runJob(owner, "ready.notify", JSON.stringify({ since: runAt - 60_000, userId }));

  expect(await mailFor(owner)).toHaveLength(1);
  expect(await notificationsOfKind(owner, userId, "ready")).toHaveLength(1);

  const saved = await owner.put("/api/notifications/preferences", {
    data: { enabled: false, kind: "recap_email" },
  });

  expect(preferencesSchema.parse(await saved.json()).preferences.recap_email).toBe(false);

  await owner.post("/__test__/mail/clear", { data: {} });
  await owner.post("/__test__/push/clear", { data: {} });

  const nextRun = runAt + 24 * 60 * 60_000;

  await moveClockTo(owner, nextRun);
  await seedReadyApplication(owner, {
    company: "Recap Direct",
    domain: "recap-direct.example",
    readyAt: nextRun,
    title: "Backend Engineer",
    userId,
  });

  await runJob(owner, "ready.notify", JSON.stringify({ since: nextRun - 60_000, userId }));

  await waitForPushTitle(owner, keys, "Overture recap: 1 ready to approve, 1 need an answer");

  expect(await mailFor(owner)).toHaveLength(0);
  expect(await notificationsOfKind(owner, userId, "ready")).toHaveLength(2);

  await owner.dispose();
});

test("a kind turned off stops its row and its push, and the routes are private", async ({
  notify,
}) => {
  const { owner, userId } = await ownerContextFor(notify.server.url);

  await moveClockTo(owner, AT);

  const preferences = await owner.get("/api/notifications/preferences");

  expect(preferences.headers()["cache-control"]).toBe("private, no-store");

  const initial = preferencesSchema.parse(await preferences.json()).preferences;

  expect(initial.review).toBe(true);
  expect(initial.recap_email).toBe(true);

  const app = await seedSentApplication(owner, {
    company: "Halden Systems",
    domain: "halden.example",
    sentAt: AT - 60 * 60_000,
    title: "Site Reliability Engineer",
    userId,
  });

  await owner.put("/api/notifications/preferences", {
    data: { enabled: false, kind: "review" },
  });

  const pushesBefore = (await jobsOfKind(owner, "push.notify")).length;
  const reviewsBefore = (await notificationsOfKind(owner, userId, "review")).length;

  await owner.post("/__test__/reviews/open", {
    data: {
      applicationIds: [app],
      fieldType: "text",
      prompt: "How did you hear about us?",
      reason: "unknown_required",
      scope: "",
      userId,
    },
  });

  expect((await notificationsOfKind(owner, userId, "review")).length).toBe(reviewsBefore);
  expect((await jobsOfKind(owner, "push.notify")).length).toBe(pushesBefore);

  await owner.put("/api/notifications/preferences", {
    data: { enabled: true, kind: "review" },
  });

  await owner.post("/__test__/reviews/open", {
    data: {
      applicationIds: [app],
      fieldType: "text",
      prompt: "What is your notice period?",
      reason: "unknown_required",
      scope: "",
      userId,
    },
  });

  await waitForNotification(owner, userId, "review", "A question for you");

  expect((await jobsOfKind(owner, "push.notify")).length).toBeGreaterThan(pushesBefore);

  const anonymous = await apiRequest.newContext({ baseURL: notify.server.url });
  const unauthorised = await anonymous.get("/api/notifications");

  expect(unauthorised.status()).toBe(401);
  expect(unauthorised.headers()["cache-control"]).toBe("private, no-store");
  expect((await anonymous.get("/api/notifications/preferences")).status()).toBe(401);

  const list = await owner.get("/api/notifications");

  expect(list.status()).toBe(200);
  expect(list.headers()["cache-control"]).toBe("private, no-store");

  await anonymous.dispose();
  await owner.dispose();
});
