import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "@playwright/test";
import type { APIRequestContext, Browser } from "@playwright/test";
import { dkimSign } from "mailauth";
import { z } from "zod";

import type { AppServer } from "./app-server.ts";
import { pinSendWindowClock, setPinnedClockOffset } from "./send-window-clock.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startTxtDnsServer } from "./dns.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import { INBOUND_HEADERS, forwardingIdFrom, signInbound } from "./inbound-mail.fixture.ts";
import {
  approveApplication,
  grantApplications,
  homeFor,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const secret = "e2e-inbound-hmac-secret-0123456789";
const signingDomain = "us.greenhouse-mail.io";
const selector = "overture";
const mailDomain = "tryoverture.com";

const code = "A1B2C3D4";

const wrongCode = "Z9Y8X7W6";

let dns: Awaited<ReturnType<typeof startTxtDnsServer>> | undefined;
let privateKeyPem = "";

interface CodeHarness {
  fixture: GreenhouseFixture;
  server: AppServer;
}

const test = appTest.extend<{ codes: CodeHarness }>({
  codes: [
    async ({ identityServer }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-code-wait-"));
      const fixture = startGreenhouseFixture({ code });

      fixture.state.codePrompt = true;

      if (dns === undefined) {
        throw new Error("The DNS fixture is not running.");
      }

      const server = await startFreshAppServer(identityServer, {
        TEST_CLOCK_AT_UTC_HOUR: "10",
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: join(directory, "browsers"),
        GREENHOUSE_BOARD_BASE_URL: fixture.url,
        INBOUND_DNS_SERVER: dns.server,
        INBOUND_HMAC_SECRET: secret,
        MAIL_DOMAIN: mailDomain,
      });

      await provide({ fixture, server });
      await server.stop();
      fixture.close();
    },
    { scope: "test" },
  ],
});

test.describe.configure({ mode: "serial", timeout: 120_000 });

const applicationRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  stage: z.string().nullable(),
  attempts: z.number(),
});

const applicationDetailSchema = z.object({
  application: applicationRowSchema.extend({ statusReason: z.string().nullable() }),
  snapshot: z.unknown().nullable(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const attemptSchema = z.object({
  id: z.string(),
  outcome: z.string().nullable(),
  submitClickedAt: z.number().nullable(),
  submitResponseStatus: z.number().nullable(),
  codeUsed: z.boolean(),
});

const attemptsSchema = z.object({ attempts: z.array(attemptSchema) });

const openWaitSchema = z.object({
  id: z.string(),
  attemptId: z.string().nullable(),
  applicationId: z.string(),
  company: z.string(),
  title: z.string(),
  startedAt: z.number(),
  expiresAt: z.number(),
});

const openWaitsSchema = z.object({ waits: z.array(openWaitSchema) });

const waitSchema = z.object({
  id: z.string(),
  resolvedAt: z.number().nullable(),
  resolvedBy: z.string().nullable(),
  code: z.string().nullable(),
});

const messageSchema = z.object({
  id: z.string(),
  rfcMessageId: z.string(),
  auth: z.string(),
  classification: z.string().nullable(),
  codeConsumedAt: z.number().nullable(),
});

const messagesSchema = z.object({ messages: z.array(messageSchema) });

const notificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
});

const notificationsSchema = z.object({ notifications: z.array(notificationSchema) });

const mailboxSchema = z.object({ address: z.string() });

const fixtureStateSchema = z.object({
  submissions: z.number(),
  applicationRequests: z.number(),
  formLoads: z.number(),
  confirmationLoads: z.number(),
});

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const facts = [
  { key: "legal_name", value: "Maya Okafor" },
  { key: "email", value: "maya.okafor@example.com" },
  { key: "phone", value: "+1 416 555 0199" },
  { key: "current_country", value: "United Kingdom" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor" },
  { key: "website_url", value: "https://maya-okafor.example" },
];

const blankStreetQuestions = [
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
    answerKind: "open_text" as const,
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

function fixtureFile(name: string) {
  return readFileSync(join(process.cwd(), "test/e2e/fixtures/mail", name), "utf8");
}

async function sign(raw: string) {
  const result = await dkimSign(raw, {
    signTime: new Date("2026-11-19T15:00:00Z"),
    signatureData: [{ signingDomain, selector, privateKey: privateKeyPem }],
  });

  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.err.message).join("; "));
  }

  return `${result.signatures}${raw}`;
}

async function clockNow(server: AppServer) {
  const response = await fetch(`${server.url}/__test__/clock`);

  return clockSchema.parse(await response.json());
}

async function setClockOffset(server: AppServer, owner: APIRequestContext, deltaMs: number) {
  await setPinnedClockOffset(server, owner, deltaMs);
}

async function postInbound(server: AppServer, raw: string, rcptTo: string) {
  const body = new TextEncoder().encode(raw);
  const timestamp = Math.trunc((await clockNow(server)).now / 1000);
  const signed = await signInbound(secret, { timestamp, rcptTo, body });

  return fetch(`${server.url}/internal/mail/inbound`, {
    method: "POST",
    headers: {
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.rcptTo]: rcptTo,
      [INBOUND_HEADERS.mailFrom]: "owner@forwarder.test",
      "content-type": "message/rfc822",
    },
    body: Buffer.from(body),
  });
}

async function runDueJobs(owner: APIRequestContext) {
  const response = await owner.post("/__test__/jobs/run-due");

  expect(response.ok()).toBe(true);
}

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await pinSendWindowClock(server);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

  const running = await owner.post("/api/running", { data: { running: true } });

  expect(running.ok()).toBe(true);

  return { owner, userId };
}

async function mailboxAddress(owner: APIRequestContext) {
  const response = await owner.get("/api/profile/mailbox");
  const body = mailboxSchema.parse(await response.json());
  const id = await forwardingIdFrom(secret, body.address);

  if (id === null) {
    throw new Error(`The app returned an invalid forwarding address: ${body.address}`);
  }

  return { address: body.address, id };
}

async function uploadResume(owner: APIRequestContext) {
  const response = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });

  expect(response.ok()).toBe(true);
}

async function saveFacts(owner: APIRequestContext) {
  const response = await owner.put("/api/profile/facts", { data: { facts } });

  expect(response.ok()).toBe(true);
}

async function seedBlankStreetPosting(owner: APIRequestContext, fixtureUrl: string) {
  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  return seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    questions: blankStreetQuestions,
    tags: [{ dimension: "subrole", value: "Operations" }],
    title: "Assistant General Manager | Durham",
    url: `${fixtureUrl}/blankstreet/jobs/8004209003`,
  });
}

const questionsSchema = z.object({
  questions: z.array(z.object({ questionId: z.string(), text: z.string() })),
});

async function seedOpenText(
  owner: APIRequestContext,
  userId: string,
  applicationId: string,
  postingId: string,
) {
  const response = await owner.get(
    `/__test__/questions?userId=${encodeURIComponent(userId)}&postingId=${encodeURIComponent(postingId)}`,
  );

  const { questions } = questionsSchema.parse(await response.json());
  const question = questions.find((candidate) => candidate.text === "Website");

  if (question === undefined) {
    throw new Error("The recording has no Website question.");
  }

  const seeded = await owner.post("/__test__/application-answers", {
    data: {
      applicationId,
      questionId: question.questionId,
      kind: "open_text",
      sentences: [
        {
          sentence: "I build backend platforms for payments teams.",
          resumeLineIds: ["open-text-line"],
        },
      ],
    },
  });

  expect(seeded.ok()).toBe(true);
}

async function readyApplication(harness: CodeHarness) {
  const { owner, userId } = await ownerFor(harness.server);

  await uploadResume(owner);
  await saveFacts(owner);

  const postingId = await seedBlankStreetPosting(owner, harness.fixture.url);
  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  await seedOpenText(owner, userId, applicationId, postingId);
  await grantApplications(owner, 3);
  await approveApplication(owner, applicationId);

  return { applicationId, owner, userId };
}

async function startSend(owner: APIRequestContext, applicationId: string) {
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

async function waitForOpenWait(owner: APIRequestContext) {
  await expect.poll(async () => (await openWaits(owner)).length, { timeout: 30_000 }).toBe(1);

  const [wait] = await openWaits(owner);

  if (wait === undefined) {
    throw new Error("The code wait was not listed.");
  }

  return wait;
}

async function readWait(owner: APIRequestContext, waitId: string) {
  const response = await owner.get(`/__test__/mail/code-waits/${waitId}`);

  return waitSchema.parse(await response.json());
}

async function storedMessages(owner: APIRequestContext, mailboxId: string) {
  const response = await owner.get(
    `/__test__/mail/messages?mailboxId=${encodeURIComponent(mailboxId)}`,
  );

  return messagesSchema.parse(await response.json()).messages;
}

async function notificationsOf(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/notifications?userId=${encodeURIComponent(userId)}`);

  return notificationsSchema.parse(await response.json()).notifications;
}

async function fixtureState(fixture: GreenhouseFixture) {
  return fixtureStateSchema.parse(await (await fetch(`${fixture.url}/__fixture__/state`)).json());
}

function typedCode(fixture: GreenhouseFixture) {
  return ["0", "1", "2", "3", "4", "5", "6", "7"]
    .map((digit) => fixture.state.lastForm[`security-input-${digit}`] ?? "")
    .join("");
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

test.beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const record = `v=DKIM1; k=ed25519; p=${Buffer.from(publicDer.subarray(-32)).toString("base64")}`;

  dns = await startTxtDnsServer({
    [`${selector}._domainkey.${signingDomain}`]: [record],
  });
});

test.afterAll(async () => {
  if (dns !== undefined) {
    await dns.stop();
  }
});

test("a code in the recorded mail is typed into the Greenhouse form and the send completes", async ({
  codes,
}) => {
  const { applicationId, owner, userId } = await readyApplication(codes);
  const mailbox = await mailboxAddress(owner);

  const sending = startSend(owner, applicationId);
  const wait = await waitForOpenWait(owner);

  expect(wait.applicationId).toBe(applicationId);
  expect(wait.company).toBe("Blank Street");
  expect(wait.title).toBe("Assistant General Manager | Durham");

  const messageId = crypto.randomUUID();
  const raw = fixtureFile("greenhouse-code.eml").replaceAll("__MESSAGE_ID__", messageId);
  const posted = await postInbound(codes.server, await sign(raw), mailbox.address);

  expect(posted.status).toBe(204);

  await runDueJobs(owner);
  await expect.poll(async () => (await storedMessages(owner, mailbox.id)).length).toBe(1);

  const response = await sending;

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(detail.application.stage).toBe("applied");
  expect(detail.snapshot).not.toBeNull();

  const state = await fixtureState(codes.fixture);

  expect(state.applicationRequests).toBe(2);
  expect(typedCode(codes.fixture)).toBe(code);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts.length).toBe(1);
  expect(attempts[0]?.outcome).toBe("sent");
  expect(attempts[0]?.codeUsed).toBe(true);
  expect(attempts[0]?.submitResponseStatus).toBe(201);

  const resolved = await readWait(owner, wait.id);

  expect(resolved.resolvedBy).toBe("mail");
  expect(resolved.code).toBe(code);

  const [message] = await storedMessages(owner, mailbox.id);

  expect(message?.auth).toBe("pass");
  expect(message?.classification).toBe("code");
  expect(message?.codeConsumedAt).not.toBeNull();

  expect(await openWaits(owner)).toHaveLength(0);
  expect((await homeFor(owner)).applicationsLeft).toBe(2);

  const [application] = await applicationsOf(owner, userId);

  expect(application?.attempts).toBe(1);
});

test("a pasted code resumes the waiting send in the same browser session and submits a second time", async ({
  codes,
}) => {
  const { applicationId, owner } = await readyApplication(codes);

  const sending = startSend(owner, applicationId);
  const wait = await waitForOpenWait(owner);

  const pasted = await owner.post(`/api/mail/code-waits/${wait.id}`, { data: { code } });

  expect(pasted.ok()).toBe(true);

  const response = await sending;

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(detail.snapshot).not.toBeNull();

  const state = await fixtureState(codes.fixture);

  expect(state.applicationRequests).toBe(2);
  expect(typedCode(codes.fixture)).toBe(code);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts[0]?.outcome).toBe("sent");
  expect(attempts[0]?.codeUsed).toBe(true);

  const resolved = await readWait(owner, wait.id);

  expect(resolved.resolvedBy).toBe("paste");
  expect(resolved.code).toBe(code);

  const again = await owner.post(`/api/mail/code-waits/${wait.id}`, { data: { code: wrongCode } });

  expect(again.status()).toBe(409);
  expect(await openWaits(owner)).toHaveLength(0);
});

test("a code in unauthenticated mail is ignored, and the paste finishes the send", async ({
  codes,
}) => {
  const { applicationId, owner } = await readyApplication(codes);
  const mailbox = await mailboxAddress(owner);

  const sending = startSend(owner, applicationId);
  const wait = await waitForOpenWait(owner);

  const messageId = crypto.randomUUID();
  const raw = fixtureFile("greenhouse-code.eml").replaceAll("__MESSAGE_ID__", messageId);
  const posted = await postInbound(codes.server, raw, mailbox.address);

  expect(posted.status).toBe(204);

  await runDueJobs(owner);
  await expect.poll(async () => (await storedMessages(owner, mailbox.id)).length).toBe(1);

  const [message] = await storedMessages(owner, mailbox.id);

  expect(message?.auth).toBe("none");
  expect(message?.classification).toBe("code");
  expect(message?.codeConsumedAt).toBeNull();
  expect((await readWait(owner, wait.id)).resolvedAt).toBeNull();
  expect((await openWaits(owner)).map((entry) => entry.id)).toContain(wait.id);

  const state = await fixtureState(codes.fixture);

  expect(state.applicationRequests).toBe(1);

  const pasted = await owner.post(`/api/mail/code-waits/${wait.id}`, { data: { code } });

  expect(pasted.ok()).toBe(true);

  const response = await sending;

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(typedCode(codes.fixture)).toBe(code);

  const [stored] = await storedMessages(owner, mailbox.id);

  expect(stored?.codeConsumedAt).toBeNull();
});

test("no code within the limit ends the try before Submit, asks for a paste at five minutes and charges nothing", async ({
  codes,
}) => {
  const { applicationId, owner, userId } = await readyApplication(codes);

  const sending = startSend(owner, applicationId);
  const wait = await waitForOpenWait(owner);

  await setClockOffset(codes.server, owner, 6 * 60_000);

  await expect.poll(async () => (await notificationsOf(owner, userId)).length).toBe(1);

  const [notification] = await notificationsOf(owner, userId);

  expect(notification?.kind).toBe("code_wait");
  expect(notification?.title).toContain("Blank Street");
  expect(notification?.body).toContain("ten minutes");
  expect((await readWait(owner, wait.id)).resolvedAt).toBeNull();

  await setClockOffset(codes.server, owner, 11 * 60_000);

  const response = await sending;

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("approved");
  expect(detail.snapshot).toBeNull();

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts.length).toBe(1);
  expect(attempts[0]?.outcome).toBe("code_timeout");
  expect(attempts[0]?.submitClickedAt).toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBe(428);
  expect(attempts[0]?.codeUsed).toBe(false);

  const state = await fixtureState(codes.fixture);

  expect(state.applicationRequests).toBe(1);
  expect(state.confirmationLoads).toBe(0);

  const expired = await owner.post(`/api/mail/code-waits/${wait.id}`, { data: { code } });

  expect(expired.status()).toBe(409);
  expect(await openWaits(owner)).toHaveLength(0);
  expect((await homeFor(owner)).applicationsLeft).toBe(3);
});

async function openHome(
  browser: Browser,
  codes: CodeHarness,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
) {
  const context = await browser.newContext({ baseURL: codes.server.url, storageState });
  const page = await context.newPage();

  await page.goto(`${codes.server.url}/home`);

  return { context, page };
}

test("Home asks for the code at five minutes and the sheet's paste resumes the same attempt", async ({
  browser,
  codes,
}) => {
  const { applicationId, owner, userId } = await readyApplication(codes);
  const storageState = await owner.storageState();
  const sending = startSend(owner, applicationId);

  await waitForOpenWait(owner);

  const early = await openHome(browser, codes, storageState);

  await expect(early.page.getByTestId("home-code-wait")).toHaveCount(0);
  await early.context.close();

  await setClockOffset(codes.server, owner, 6 * 60_000);

  await expect.poll(async () => (await notificationsOf(owner, userId)).length).toBe(1);

  const [notification] = await notificationsOf(owner, userId);

  expect(notification?.kind).toBe("code_wait");

  const { context, page } = await openHome(browser, codes, storageState);

  await expect(page.getByRole("heading", { name: "Blank Street needs a code." })).toBeVisible();
  await expect(page.getByText(/^Expires in \d+:\d\d$/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Paste the code" })).toBeVisible();

  await page.getByRole("button", { name: "Paste the code" }).click();

  const sheet = page.getByTestId("code-paste-sheet");

  await expect(sheet.getByRole("heading", { name: "Paste the code." })).toBeVisible();

  await sheet.getByLabel("Verification code").fill(code);
  await sheet.getByRole("button", { name: "Submit code" }).click();

  await expect(sheet.getByRole("heading", { name: "Submitted with your code." })).toBeVisible({
    timeout: 15_000,
  });
  await expect(sheet.getByText("Code accepted")).toBeVisible();
  await expect(page.getByTestId("home-code-wait")).toHaveCount(0);

  const response = await sending;

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(detail.application.stage).toBe("applied");
  expect(typedCode(codes.fixture)).toBe(code);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts.length).toBe(1);
  expect(attempts[0]?.outcome).toBe("sent");
  expect(attempts[0]?.codeUsed).toBe(true);

  await context.close();
});

test("a forwarded code arriving first resolves the wait and the Home card goes away", async ({
  browser,
  codes,
}) => {
  const { applicationId, owner } = await readyApplication(codes);
  const mailbox = await mailboxAddress(owner);
  const storageState = await owner.storageState();
  const sending = startSend(owner, applicationId);

  const wait = await waitForOpenWait(owner);

  await setClockOffset(codes.server, owner, 6 * 60_000);

  const { context, page } = await openHome(browser, codes, storageState);

  const card = page.getByTestId("home-code-wait");

  await expect(card).toBeVisible();

  const messageId = crypto.randomUUID();
  const raw = fixtureFile("greenhouse-code.eml").replaceAll("__MESSAGE_ID__", messageId);

  expect((await postInbound(codes.server, await sign(raw), mailbox.address)).status).toBe(204);

  await runDueJobs(owner);
  await expect.poll(async () => (await storedMessages(owner, mailbox.id)).length).toBe(1);
  await expect(card).toHaveCount(0);

  const response = await sending;

  expect(response.ok()).toBe(true);
  expect((await applicationOf(owner, applicationId)).application.status).toBe("sent");
  expect((await readWait(owner, wait.id)).resolvedBy).toBe("mail");

  await context.close();
});

test("an expired wait is refused with a clear message and the sheet closes its window", async ({
  browser,
  codes,
}) => {
  const { applicationId, owner } = await readyApplication(codes);
  const storageState = await owner.storageState();
  const sending = startSend(owner, applicationId);

  await waitForOpenWait(owner);
  await setClockOffset(codes.server, owner, 6 * 60_000);

  const { context, page } = await openHome(browser, codes, storageState);

  await page.getByRole("button", { name: "Paste the code" }).click();

  const sheet = page.getByTestId("code-paste-sheet");

  await sheet.getByLabel("Verification code").fill(code);

  await setClockOffset(codes.server, owner, 11 * 60_000);
  await sheet.getByRole("button", { name: "Submit code" }).click();

  await expect(sheet.getByRole("heading", { name: "The code never arrived." })).toBeVisible();
  await expect(sheet.getByText("Window closed")).toBeVisible();
  await expect(sheet.getByRole("alert")).toContainText("That wait has closed");

  const response = await sending;

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("approved");
  expect(detail.snapshot).toBeNull();

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts[0]?.outcome).toBe("code_timeout");
  expect(attempts[0]?.codeUsed).toBe(false);

  await context.close();
});
