import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dkimSign } from "mailauth";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { request as apiRequest } from "@playwright/test";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startTxtDnsServer } from "./dns.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import { INBOUND_HEADERS, forwardingIdFrom, signInbound } from "./inbound-mail.fixture.ts";
import {
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const secret = "e2e-send-outcomes-0123456789abcdef";
const signingDomain = "us.greenhouse-mail.io";
const selector = "overture";
const confirmDeadlineHours = 24;

interface OutcomeHarness {
  address: string;
  fixture: GreenhouseFixture;
  mailboxId: string;
  privateKeyPem: string;
  server: AppServer;
  sessionDirectory: string;
}

const test = appTest.extend<{ outcomes: OutcomeHarness }>({
  outcomes: [
    async ({ identityServer }, provide) => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const publicDer = publicKey.export({ type: "spki", format: "der" });
      const record = `v=DKIM1; k=ed25519; p=${Buffer.from(publicDer.subarray(-32)).toString("base64")}`;

      const dns = await startTxtDnsServer({
        [`${selector}._domainkey.${signingDomain}`]: [record],
      });

      const directory = mkdtempSync(join(tmpdir(), "overture-send-outcomes-"));
      const fixture = startGreenhouseFixture();
      const sessionDirectory = join(directory, "browsers");

      const server = await startFreshAppServer(identityServer, {
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: sessionDirectory,
        GREENHOUSE_BOARD_BASE_URL: fixture.url,
        GREENHOUSE_FEED_BASE_URL: fixture.url,
        INBOUND_DNS_SERVER: dns.server,
        INBOUND_HMAC_SECRET: secret,
        MAIL_DOMAIN: "tryoverture.com",
      });

      const owner = await apiRequestFor(server);
      const mailboxResponse = await owner.get("/api/profile/mailbox");
      const { address } = z.object({ address: z.string() }).parse(await mailboxResponse.json());
      const mailboxId = await forwardingIdFrom(secret, address);

      await owner.dispose();

      if (mailboxId === null) {
        throw new Error("the app returned an invalid forwarding address");
      }

      await provide({
        address,
        fixture,
        mailboxId,
        privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }),
        server,
        sessionDirectory,
      });

      await server.stop();
      fixture.close();
      await dns.stop();
    },
    { scope: "test" },
  ],
});

async function apiRequestFor(server: AppServer) {
  const { owner } = await ownerContextFor(server.url);

  return owner;
}

const applicationRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
  stage: z.string().nullable(),
  sentAt: z.union([z.number(), z.string()]).nullable(),
  scheduledFor: z.number().nullable(),
  attempts: z.number(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const attemptSchema = z.object({
  id: z.string(),
  n: z.number(),
  outcome: z.string().nullable(),
  submitClickedAt: z.number().nullable(),
  submitResponseStatus: z.number().nullable(),
  endedAt: z.number().nullable(),
});

const attemptsSchema = z.object({ attempts: z.array(attemptSchema) });

const snapshotSchema = z.object({
  confirmedBy: z.string(),
  costMicros: z.number(),
});

const applicationDetailSchema = z.object({
  application: applicationRowSchema,
  snapshot: snapshotSchema.nullable(),
});

const fixtureStateSchema = z.object({
  applicationRequests: z.number(),
  formLoads: z.number(),
  confirmationLoads: z.number(),
});

const homeSchema = z.object({
  applicationsLeft: z.number(),
  sentToday: z.number(),
});

const threadsSchema = z.object({
  threads: z.array(
    z.object({
      id: z.string(),
      applicationId: z.string().nullable(),
    }),
  ),
});

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });

const openWaitSchema = z.object({
  id: z.string(),
  attemptId: z.string().nullable(),
});

const openWaitsSchema = z.object({ waits: z.array(openWaitSchema) });

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const facts = [
  { key: "legal_name", value: "Maya Okafor" },
  { key: "email", value: "maya.okafor@example.com" },
  { key: "phone", value: "+1 416 555 0199" },
  { key: "current_country", value: "United Kingdom" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor" },
  { key: "website_url", value: "https://maya-okafor.example" },
];

const formQuestions = [
  {
    text: "First Name",
    fieldName: "first_name",
    fieldType: "text" as const,
    factKey: "legal_name",
    answerKind: "fact" as const,
    required: true,
  },
  {
    text: "Last Name",
    fieldName: "last_name",
    fieldType: "text" as const,
    factKey: "legal_name",
    answerKind: "fact" as const,
    required: true,
  },
  {
    text: "Email",
    fieldName: "email",
    fieldType: "email" as const,
    factKey: "email",
    answerKind: "fact" as const,
    required: true,
  },
  {
    text: "Phone",
    fieldName: "phone",
    fieldType: "phone" as const,
    factKey: "phone",
    answerKind: "fact" as const,
    required: false,
  },
  {
    text: "Country",
    fieldName: "country",
    fieldType: "select" as const,
    options: ["Canada", "United Kingdom", "United States"],
    factKey: "current_country",
    answerKind: "fact" as const,
    required: false,
  },
  {
    text: "LinkedIn Profile",
    fieldName: "question_32895467003",
    fieldType: "url" as const,
    factKey: "linkedin_url",
    answerKind: "fact" as const,
    required: false,
  },
  {
    text: "Website",
    fieldName: "question_32895468003",
    fieldType: "text" as const,
    answerKind: "skip" as const,
    required: false,
  },
  {
    text: "Resume/CV",
    fieldName: "resume",
    fieldType: "file" as const,
    answerKind: "skip" as const,
    required: true,
  },
];

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });
  const running = await owner.post("/api/running", { data: { running: true } });

  expect(running.ok()).toBe(true);

  return { owner, userId };
}

async function prepare(owner: APIRequestContext) {
  const resumeResponse = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });

  expect(resumeResponse.ok()).toBe(true);

  const factsResponse = await owner.put("/api/profile/facts", { data: { facts } });

  expect(factsResponse.ok()).toBe(true);
}

async function seedBlankStreetPosting(owner: APIRequestContext, fixtureUrl: string) {
  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  return seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    questions: formQuestions,
    tags: [{ dimension: "subrole", value: "Operations" }],
    title: "Assistant General Manager | Durham",
    url: `${fixtureUrl}/blankstreet/jobs/8004209003`,
  });
}

async function readyApplication(harness: OutcomeHarness, verify = false) {
  const { owner, userId } = await ownerFor(harness.server);

  await prepare(owner);

  harness.fixture.state.codePrompt = verify;

  const postingId = await seedBlankStreetPosting(owner, harness.fixture.url);

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  await grantApplications(owner, 3);

  return { applicationId, owner, userId };
}

async function runSend(owner: APIRequestContext, applicationId: string) {
  return owner.post("/__test__/jobs/run-now", {
    data: { kind: "application.send", payload: JSON.stringify({ applicationId }) },
    timeout: 120_000,
  });
}

async function openWaits(owner: APIRequestContext) {
  const response = await owner.get("/api/mail/code-waits");

  expect(response.ok()).toBe(true);

  return openWaitsSchema.parse(await response.json()).waits;
}

async function waitForOpenCodeWait(owner: APIRequestContext) {
  await expect.poll(async () => (await openWaits(owner)).length, { timeout: 30_000 }).toBe(1);

  const [wait] = await openWaits(owner);

  if (wait === undefined) {
    throw new Error("the code wait was not listed");
  }

  return wait;
}

async function runDueJobs(owner: APIRequestContext) {
  const response = await owner.post("/__test__/jobs/run-due");

  expect(response.ok()).toBe(true);
}

async function applicationOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`);

  return applicationDetailSchema.parse(await response.json());
}

async function attemptsOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return attemptsSchema.parse(await response.json()).attempts;
}

async function applicationsOf(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`);

  return applicationsSchema.parse(await response.json()).applications;
}

async function fixtureState(fixture: GreenhouseFixture) {
  return fixtureStateSchema.parse(await (await fetch(`${fixture.url}/__fixture__/state`)).json());
}

async function homeOf(owner: APIRequestContext) {
  return homeSchema.parse(await (await owner.get("/api/home")).json());
}

function sessionRecords(directory: string) {
  return readdirSync(directory).filter((name) => name.endsWith(".json"));
}

async function holdConfirmation(fixture: GreenhouseFixture) {
  await fetch(`${fixture.url}/__fixture__/hold`, {
    body: JSON.stringify({ confirmation: true }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function releaseFixture(fixture: GreenhouseFixture) {
  await fetch(`${fixture.url}/__fixture__/release`, { method: "POST" });
}

async function crashAfterSubmit(
  harness: OutcomeHarness,
  applicationId: string,
  owner: APIRequestContext,
  userId: string,
) {
  const storageState = await owner.storageState();

  await holdConfirmation(harness.fixture);

  const sending = (async () => {
    try {
      await runSend(owner, applicationId);
    } catch {
      return null;
    }

    return null;
  })();

  await expect
    .poll(async () => (await fixtureState(harness.fixture)).confirmationLoads)
    .toBeGreaterThan(0);

  await harness.server.crash();
  await sending;
  await releaseFixture(harness.fixture);
  await harness.server.restart();

  const recoveredOwner = await apiRequest.newContext({
    baseURL: harness.server.url,
    storageState,
  });

  const [application] = await applicationsOf(recoveredOwner, userId);

  expect(application?.status).toBe("confirming");

  return { owner: recoveredOwner, userId };
}

async function signInboundAck(privateKeyPem: string, messageId: string) {
  const raw = readFileSync("test/e2e/fixtures/mail/greenhouse-ack.eml", "utf8")
    .replaceAll("Acme", "Blank Street")
    .replaceAll("__MESSAGE_ID__", messageId);

  const signed = await dkimSign(raw, {
    signatureData: [{ privateKey: privateKeyPem, selector, signingDomain }],
    signTime: new Date("2026-11-19T15:00:00Z"),
  });

  if (signed.errors.length > 0) {
    throw new Error(signed.errors.map((error) => error.err.message).join("; "));
  }

  return `${signed.signatures}${raw}`;
}

async function postInbound(owner: APIRequestContext, raw: string, address: string) {
  const body = new TextEncoder().encode(raw);

  const clock = z
    .object({ now: z.number() })
    .parse(await (await owner.get("/__test__/clock")).json());

  const signed = await signInbound(secret, {
    body,
    rcptTo: address,
    timestamp: Math.trunc(clock.now / 1000),
  });

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

async function moveClock(owner: APIRequestContext, deltaMs: number) {
  const clock = clockSchema.parse(await (await owner.get("/__test__/clock")).json());

  const response = await owner.post("/__test__/clock/offset", {
    data: { offsetMs: clock.offsetMs + deltaMs },
  });

  expect(response.ok()).toBe(true);
}

async function moveIntoWindow(owner: APIRequestContext) {
  const clock = clockSchema.parse(await (await owner.get("/__test__/clock")).json());
  const target = new Date(clock.now);

  target.setUTCHours(10, 0, 0, 0);

  if (target.getTime() <= clock.now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const response = await owner.post("/__test__/clock/offset", {
    data: { offsetMs: clock.offsetMs + (target.getTime() - clock.now) },
  });

  expect(response.ok()).toBe(true);
}

test("a 428 before Submit retries once, in a fresh session and never Confirming", async ({
  outcomes,
}) => {
  const { applicationId, owner, userId } = await readyApplication(outcomes, true);

  await moveIntoWindow(owner);

  const sending = runSend(owner, applicationId);

  await waitForOpenCodeWait(owner);

  await moveClock(owner, 11 * 60_000);

  const first = await sending;

  expect(first.ok()).toBe(true);

  const afterFirst = await applicationOf(owner, applicationId);
  const firstAttempts = await attemptsOf(owner, applicationId);

  expect(afterFirst.application.status).toBe("ready");
  expect(afterFirst.application.attempts).toBe(1);
  expect(afterFirst.snapshot).toBeNull();
  expect(firstAttempts).toHaveLength(1);
  expect(firstAttempts[0]?.outcome).toBe("code_timeout");
  expect(firstAttempts[0]?.submitClickedAt).toBeNull();
  expect(firstAttempts[0]?.submitResponseStatus).toBe(428);
  expect((await homeOf(owner)).applicationsLeft).toBe(3);

  const scheduled = afterFirst.application.scheduledFor;

  expect(scheduled).not.toBeNull();
  expect((scheduled ?? 0) - (firstAttempts[0]?.endedAt ?? 0)).toBeGreaterThanOrEqual(
    6 * 60 * 60_000 - 5000,
  );

  await moveClock(owner, 6 * 60 * 60_000 + 60_000);
  await runDueJobs(owner);
  await runDueJobs(owner);

  await expect
    .poll(async () => (await applicationOf(owner, applicationId)).application.status)
    .toBe("failed");

  const afterRetry = await applicationOf(owner, applicationId);
  const retryAttempts = await attemptsOf(owner, applicationId);

  expect(afterRetry.application.status).toBe("failed");
  expect(afterRetry.application.statusReason).toBe("blocked");
  expect(afterRetry.application.stage).toBeNull();
  expect(afterRetry.application.attempts).toBe(2);
  expect(afterRetry.snapshot).toBeNull();
  expect(retryAttempts).toHaveLength(2);
  expect(retryAttempts.every((attempt) => attempt.submitClickedAt === null)).toBe(true);
  expect(retryAttempts.map((attempt) => attempt.outcome)).toEqual(["code_timeout", "blocked"]);
  expect((await homeOf(owner)).applicationsLeft).toBe(3);

  const [application] = await applicationsOf(owner, userId);

  expect(application?.status).toBe("failed");
  expect((await fixtureState(outcomes.fixture)).applicationRequests).toBe(2);
});

test("an authenticated acknowledgement email for a Confirming Application makes it sent and linked", async ({
  outcomes,
}) => {
  const { applicationId, owner, userId } = await readyApplication(outcomes);

  const recovered = await crashAfterSubmit(outcomes, applicationId, owner, userId);

  await postInbound(
    recovered.owner,
    await signInboundAck(outcomes.privateKeyPem, crypto.randomUUID()),
    outcomes.address,
  );

  await runDueJobs(recovered.owner);
  await expect
    .poll(async () => (await applicationOf(recovered.owner, applicationId)).application.status)
    .toBe("sent");

  const detail = await applicationOf(recovered.owner, applicationId);

  expect(detail.application.stage).toBe("applied");
  expect(detail.snapshot).not.toBeNull();
  expect(detail.snapshot?.confirmedBy).toBe("email");

  const home = await homeOf(recovered.owner);

  expect(home.sentToday).toBe(1);
  expect(home.applicationsLeft).toBe(2);

  const threadsResponse = await recovered.owner.get(
    `/__test__/mail/threads?mailboxId=${encodeURIComponent(outcomes.mailboxId)}`,
  );

  const { threads } = threadsSchema.parse(await threadsResponse.json());

  expect(threads.some((thread) => thread.applicationId === applicationId)).toBe(true);
  expect((await fixtureState(outcomes.fixture)).applicationRequests).toBe(1);

  await runSend(recovered.owner, applicationId);

  expect((await applicationOf(recovered.owner, applicationId)).application.status).toBe("sent");
  expect((await fixtureState(outcomes.fixture)).applicationRequests).toBe(1);
});

test("a Confirming Application without an acknowledgement fails after the wait, guards the repost and is never retried", async ({
  outcomes,
}) => {
  const { applicationId, owner, userId } = await readyApplication(outcomes);

  const recovered = await crashAfterSubmit(outcomes, applicationId, owner, userId);
  const before = await applicationOf(recovered.owner, applicationId);

  expect(before.snapshot).toBeNull();

  await moveClock(recovered.owner, (confirmDeadlineHours + 1) * 60 * 60_000);
  await runDueJobs(recovered.owner);

  const failed = await applicationOf(recovered.owner, applicationId);

  expect(failed.application.status).toBe("failed");
  expect(failed.application.statusReason).toBe("unconfirmed");
  expect(failed.application.stage).toBeNull();
  expect(failed.application.sentAt).not.toBeNull();
  expect(failed.snapshot).toBeNull();
  expect((await homeOf(recovered.owner)).applicationsLeft).toBe(3);

  const [application] = await applicationsOf(recovered.owner, userId);

  expect(application?.status).toBe("failed");

  await runSend(recovered.owner, applicationId);

  const afterResend = await applicationOf(recovered.owner, applicationId);

  expect(afterResend.application.status).toBe("failed");
  expect((await fixtureState(outcomes.fixture)).applicationRequests).toBe(1);
});

test("a graceful shutdown before Submit interrupts the send without using a try and reschedules it", async ({
  outcomes,
}) => {
  const { applicationId, owner, userId } = await readyApplication(outcomes);

  await moveIntoWindow(owner);

  const clockState = clockSchema.parse(await (await owner.get("/__test__/clock")).json());
  const storageState = await owner.storageState();

  await fetch(`${outcomes.fixture.url}/__fixture__/hold`, {
    body: JSON.stringify({ form: true }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  const sending = (async () => {
    try {
      await runSend(owner, applicationId);
    } catch {
      return null;
    }

    return null;
  })();

  await expect
    .poll(async () => (await fixtureState(outcomes.fixture)).formLoads)
    .toBeGreaterThan(0);

  expect(sessionRecords(outcomes.sessionDirectory).length).toBe(1);

  await outcomes.server.stop();
  await sending;

  await releaseFixture(outcomes.fixture);
  await outcomes.server.restart();

  await expect.poll(() => sessionRecords(outcomes.sessionDirectory).length).toBe(0);

  const recovered = await apiRequest.newContext({
    baseURL: outcomes.server.url,
    storageState,
  });

  const [application] = await applicationsOf(recovered, userId);
  const attempts = await attemptsOf(recovered, applicationId);

  expect(application?.status).toBe("ready");
  expect(application?.attempts).toBe(0);
  expect(application?.scheduledFor).not.toBeNull();
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("interrupted");
  expect(attempts[0]?.submitClickedAt).toBeNull();

  await recovered.post("/__test__/clock/offset", { data: { offsetMs: clockState.offsetMs } });

  await runDueJobs(recovered);
  await runDueJobs(recovered);

  await expect
    .poll(async () => (await applicationOf(recovered, applicationId)).application.status)
    .toBe("sent");

  const sent = await applicationOf(recovered, applicationId);

  expect(sent.application.status).toBe("sent");
  expect((await fixtureState(outcomes.fixture)).applicationRequests).toBe(1);
});
