import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { APIRequestContext } from "@playwright/test";
import { request as apiRequest } from "@playwright/test";
import { dkimSign } from "mailauth";
import { z } from "zod";

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

const SECRET = "e2e-inbox-secret-0123456789abcd";
const SELECTOR = "overture";
const SIGNING_DOMAIN = "us.greenhouse-mail.io";

interface InboxHarness {
  server: AppServer;
  sign: (raw: string) => Promise<string>;
  signWrongKey: (raw: string) => Promise<string>;
}

const test = appTest.extend<{ inbox: InboxHarness }>({
  inbox: [
    async ({ identityServer }, provide) => {
      const good = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const wrong = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const publicDer = good.publicKey.export({ format: "der", type: "spki" });
      const record = `v=DKIM1; k=rsa; p=${Buffer.from(publicDer).toString("base64")}`;

      const dns = await startTxtDnsServer({
        [`${SELECTOR}._domainkey.${SIGNING_DOMAIN}`]: [record],
      });

      const server = await startFreshAppServer(identityServer, {
        INBOUND_DNS_SERVER: dns.server,
        INBOUND_HMAC_SECRET: SECRET,
        MAIL_DOMAIN: "tryoverture.com",
      });

      const signWith = async (raw: string, pem: string) => {
        const result = await dkimSign(raw, {
          signatureData: [{ privateKey: pem, selector: SELECTOR, signingDomain: SIGNING_DOMAIN }],
          signTime: new Date("2026-11-19T15:00:00Z"),
        });

        if (result.errors.length > 0) {
          throw new Error(result.errors.map((error) => error.err.message).join("; "));
        }

        return `${result.signatures}${raw}`;
      };

      const privateKey = (pair: typeof good) =>
        pair.privateKey.export({ format: "pem", type: "pkcs8" });

      await provide({
        server,
        sign: async (raw) => signWith(raw, privateKey(good)),
        signWrongKey: async (raw) => signWith(raw, privateKey(wrong)),
      });

      await server.stop();
      await dns.stop();
    },
    { scope: "test" },
  ],
});

const mailboxSchema = z.object({ address: z.string() });

const clockSchema = z.object({ now: z.number() });

const jobsSchema = z.object({
  jobs: z.array(z.object({ kind: z.string(), status: z.string() })),
});

const threadSchema = z.object({
  applicationId: z.string().nullable(),
  classification: z.string().nullable(),
  company: z.string(),
  id: z.string(),
  lastMessageAt: z.number(),
  needsChecking: z.boolean(),
  snippet: z.string(),
  subject: z.string(),
  title: z.string().nullable(),
  unread: z.boolean(),
});

const threadsSchema = z.object({
  counts: z.object({ all: z.number(), needsChecking: z.number(), unread: z.number() }),
  threads: z.array(threadSchema),
});

const invalidRequestSchema = z.object({ error: z.literal("invalid_request") });

const threadPageSchema = threadsSchema.extend({
  nextCursor: z.number().nullable(),
  nextCursorId: z.string().nullable(),
});

const messageSchema = z.object({
  attachments: z.array(
    z.object({ bytes: z.number(), filename: z.string(), id: z.string(), mime: z.string() }),
  ),
  auth: z.string(),
  classification: z.string().nullable(),
  createdAt: z.number(),
  direction: z.string(),
  from: z.string(),
  id: z.string(),
  readAt: z.number().nullable(),
  subject: z.string(),
  text: z.string(),
});

const threadDetailSchema = z.object({
  messages: z.array(messageSchema),
  thread: threadSchema,
});

const boardSchema = z.object({
  columns: z.array(
    z.object({
      cards: z.array(z.object({ id: z.string(), stage: z.string().nullable() })),
      stage: z.string(),
    }),
  ),
});

function fixture(name: string) {
  return readFileSync(join(process.cwd(), "test/e2e/fixtures/mail", name), "utf8");
}

function fresh(raw: string) {
  return raw
    .replaceAll("__MESSAGE_ID__", crypto.randomUUID())
    .replaceAll("__ACK_ID__", crypto.randomUUID());
}

async function serverClockSeconds(api: APIRequestContext) {
  return Math.trunc(clockSchema.parse(await (await api.get("/__test__/clock")).json()).now / 1000);
}

async function forward(api: APIRequestContext, raw: string, address: string) {
  const body = new TextEncoder().encode(raw);
  const timestamp = await serverClockSeconds(api);
  const signed = await signInbound(SECRET, { body, rcptTo: address, timestamp });

  const response = await api.post("/internal/mail/inbound", {
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

async function runMailJobs(api: APIRequestContext) {
  expect((await api.post("/__test__/jobs/run-due")).ok()).toBe(true);

  await expect
    .poll(
      async () => {
        const { jobs } = jobsSchema.parse(await (await api.get("/__test__/jobs")).json());

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

async function threadsOf(api: APIRequestContext) {
  return threadsSchema.parse(await (await api.get("/api/threads")).json());
}

async function threadOf(api: APIRequestContext, id: string) {
  return threadDetailSchema.parse(
    await (await api.get(`/api/threads/${encodeURIComponent(id)}`)).json(),
  );
}

async function addressOf(api: APIRequestContext) {
  return mailboxSchema.parse(await (await api.get("/api/profile/mailbox")).json()).address;
}

async function seedApplicationForOwner(api: APIRequestContext, userId: string) {
  const companyId = await seedCompany(api, "Acme", null);
  const boardId = await seedBoard(api, companyId, "greenhouse", "acme");

  const postingId = await seedPosting(api, {
    atsJobId: "senior-backend-engineer",
    boardId,
    companyId,
    title: "Senior Backend Engineer",
    url: "https://acme.example/jobs/senior-backend-engineer",
  });

  const { now } = clockSchema.parse(await (await api.get("/__test__/clock")).json());

  return seedApplication(api, { postingId, sentAt: now, status: "sent", userId });
}

test("signed ATS mail appears for its user, linked to its application, and opens its attachment", async ({
  inbox,
}) => {
  const { owner, userId } = await ownerContextFor(inbox.server.url);
  const applicationId = await seedApplicationForOwner(owner, userId);
  const address = await addressOf(owner);

  await forward(owner, await inbox.sign(fresh(fixture("greenhouse-ack.eml"))), address);
  await runMailJobs(owner);

  const afterAck = await threadsOf(owner);
  const [ackThread] = afterAck.threads;

  if (ackThread === undefined) {
    throw new Error("the signed mail was not listed in the Inbox.");
  }

  expect(afterAck.threads).toHaveLength(1);
  expect(ackThread.applicationId).toBe(applicationId);
  expect(ackThread.company).toBe("Acme");
  expect(ackThread.title).toBe("Senior Backend Engineer");
  expect(ackThread.subject).toBe("Your application to Acme");
  expect(ackThread.unread).toBe(true);
  expect(ackThread.needsChecking).toBe(false);
  expect(ackThread.classification).toBe("ack");
  expect(afterAck.counts).toEqual({ all: 1, needsChecking: 0, unread: 1 });

  const detail = await threadOf(owner, ackThread.id);
  const [ackMessage] = detail.messages;

  if (ackMessage === undefined) {
    throw new Error("the thread had no message.");
  }

  expect(ackMessage.from).toContain("no-reply@us.greenhouse-mail.io");
  expect(ackMessage.text).toContain("Thank you for applying to Acme.");
  expect(ackMessage.attachments).toHaveLength(0);

  const marked = await owner.post(`/api/messages/${encodeURIComponent(ackMessage.id)}/read`);

  expect(marked.status()).toBe(200);
  expect((await threadsOf(owner)).counts.unread).toBe(0);

  await forward(owner, await inbox.sign(fresh(fixture("greenhouse-interview-brief.eml"))), address);
  await runMailJobs(owner);

  const briefThread = (await threadsOf(owner)).threads.find((thread) =>
    thread.subject.includes("brief"),
  );

  if (briefThread === undefined) {
    throw new Error("the attachment mail was not listed.");
  }

  const briefDetail = await threadOf(owner, briefThread.id);
  const briefMessage = briefDetail.messages.at(0);
  const attachment = briefMessage?.attachments[0];

  if (briefMessage === undefined || attachment === undefined) {
    throw new Error("the attachment was not kept.");
  }

  expect(briefMessage.attachments).toHaveLength(1);
  expect(attachment.filename).toBe("Interview_Brief.pdf");
  expect(attachment.mime).toBe("application/pdf");

  const download = await owner.get(`/api/attachments/${encodeURIComponent(attachment.id)}`);

  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect(download.headers()["content-disposition"]).toContain("Interview_Brief.pdf");
  expect(download.headers()["x-content-type-options"]).toBe("nosniff");
  expect(download.headers()["cache-control"]).toBe("private, no-store");
  expect((await owner.get("/api/threads")).headers()["cache-control"]).toBe("no-store");

  const bytes = await download.body();

  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

  await owner.dispose();
});

test("a fresh user walks the Inbox through the real UI, from empty to the Board card", async ({
  browser,
  inbox,
}) => {
  const { owner, userId } = await ownerContextFor(inbox.server.url);
  const applicationId = await seedApplicationForOwner(owner, userId);
  const address = await addressOf(owner);

  const context = await browser.newContext({ storageState: await owner.storageState() });
  const page = await context.newPage();

  await page.goto(`${inbox.server.url}/inbox`);
  await expect(page.getByRole("heading", { name: /Nothing forwarded/u })).toBeVisible();

  await forward(owner, await inbox.sign(fresh(fixture("greenhouse-ack.eml"))), address);
  await forward(owner, await inbox.sign(fresh(fixture("greenhouse-interview-brief.eml"))), address);
  await runMailJobs(owner);

  await page.reload();
  await expect(page.getByRole("button", { name: "All (2)" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Unread \(\d+\)$/u })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search messages…" });

  await search.fill("no-such-employer");
  await expect(page.getByText("No threads match this filter.")).toBeVisible();
  await search.fill("");

  await page.getByRole("button").filter({ hasText: "Interview with Acme: the brief" }).click();

  const briefThread = (await threadsOf(owner)).threads.find((thread) =>
    thread.subject.includes("brief"),
  );

  await expect(page).toHaveURL(`${inbox.server.url}/inbox/${briefThread?.id ?? ""}`);

  const attachmentLink = page.getByRole("link", { name: "Download" });

  await expect(page.getByText("Interview_Brief.pdf")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await threadsOf(owner)).threads.find((thread) => thread.id === briefThread?.id)?.unread,
    )
    .toBe(false);
  expect((await threadsOf(owner)).counts.unread).toBeLessThanOrEqual(1);

  const downloading = page.waitForEvent("download");

  await attachmentLink.click();

  const download = await downloading;

  expect(download.suggestedFilename()).toBe("Interview_Brief.pdf");

  const saved = await download.path();

  expect(readFileSync(saved).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("link", { name: /View in Applications/u }).click();
  await expect(page).toHaveURL(new RegExp(`/tracker\\?card=${applicationId}`, "u"));
  await expect(page.getByRole("dialog", { name: "Application detail" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Application detail" })).toContainText(
    "Senior Backend Engineer",
  );

  await context.close();
  await owner.dispose();
});

test("the Inbox shows an error with retry, never the empty state, and copy waits for the address", async ({
  browser,
  inbox,
}) => {
  const { owner } = await ownerContextFor(inbox.server.url);
  const context = await browser.newContext({ storageState: await owner.storageState() });
  const page = await context.newPage();

  await page.route("**/api/threads", async (route) => route.fulfill({ status: 500 }));
  await page.goto(`${inbox.server.url}/inbox`);
  await expect(page.getByRole("alert")).toContainText("The Inbox could not be loaded.", {
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: /Nothing forwarded/u })).toHaveCount(0);

  await page.unroute("**/api/threads");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: /Nothing forwarded/u })).toBeVisible();

  await page.route("**/api/profile/mailbox", async (route) => route.fulfill({ status: 500 }));
  await page.goto(`${inbox.server.url}/inbox/address`);
  await expect(page.getByRole("button", { name: "Copy address" })).toBeDisabled();

  await page.unroute("**/api/profile/mailbox");
  await page.reload();
  await expect(page.getByRole("button", { name: "Copy address" })).toBeEnabled();

  await context.close();
  await owner.dispose();
});

test("a message that failed DKIM is labelled, linked, and moves no card", async ({ inbox }) => {
  const { owner, userId } = await ownerContextFor(inbox.server.url);
  const applicationId = await seedApplicationForOwner(owner, userId);
  const address = await addressOf(owner);

  await forward(
    owner,
    await inbox.signWrongKey(fresh(fixture("greenhouse-rejection.eml"))),
    address,
  );
  await runMailJobs(owner);

  const listed = await threadsOf(owner);
  const thread = listed.threads.find((row) => row.needsChecking);

  if (thread === undefined) {
    throw new Error("the failed-auth message was not labelled.");
  }

  expect(thread.applicationId).toBe(applicationId);
  expect(thread.company).toBe("Acme");
  expect(listed.counts.needsChecking).toBe(1);

  const detail = await threadOf(owner, thread.id);

  expect(detail.messages[0]?.auth).toBe("fail");

  const board = boardSchema.parse(await (await owner.get("/api/board")).json());

  const card = board.columns
    .flatMap((column) => column.cards)
    .find((row) => row.id === applicationId);

  expect(card?.stage).toBe("applied");

  await owner.dispose();
});

test("threads and attachments are scoped to their user", async ({ inbox }) => {
  const { owner, userId } = await ownerContextFor(inbox.server.url);

  await seedApplicationForOwner(owner, userId);

  const burner = z.object({ id: z.string() }).parse(
    await (
      await owner.post("/__test__/users", {
        data: { email: "burner@example.com", name: "Burner" },
      })
    ).json(),
  );

  const seeded = z.object({ messageId: z.string(), threadId: z.string() }).parse(
    await (
      await owner.post("/__test__/mail/seed", {
        data: {
          applicationId: null,
          attachments: [],
          auth: "pass",
          classification: "ack",
          from: "Burner Co <no-reply@burner.example>",
          senderDomain: "burner.example",
          subject: "Burner only",
          text: "This mail belongs to the burner account.",
          userId: burner.id,
        },
      })
    ).json(),
  );

  const ownerThreads = await threadsOf(owner);

  expect(ownerThreads.threads.map((thread) => thread.subject)).not.toContain("Burner only");
  expect((await owner.get(`/api/threads/${encodeURIComponent(seeded.threadId)}`)).status()).toBe(
    404,
  );

  const anonymous = await apiRequest.newContext({ baseURL: inbox.server.url });

  expect((await anonymous.get("/api/threads")).status()).toBe(401);

  await anonymous.dispose();
  await owner.dispose();
});

test("the Thread list pages through a large Inbox and keeps the counts over every Thread", async ({
  inbox,
}) => {
  const { owner, userId } = await ownerContextFor(inbox.server.url);

  const bulk = await owner.post("/__test__/mail/bulk", {
    data: { bodyBytes: 256, count: 60, userId },
  });

  expect(bulk.ok()).toBe(true);

  const first = threadPageSchema.parse(await (await owner.get("/api/threads")).json());

  expect(first.threads).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  expect(first.nextCursorId).not.toBeNull();
  expect(first.counts).toEqual({ all: 60, needsChecking: 0, unread: 60 });

  const cursor = (page: typeof first) =>
    `?limit=7&before=${String(page.nextCursor)}&beforeId=${encodeURIComponent(page.nextCursorId ?? "")}`;

  const second = threadPageSchema.parse(
    await (await owner.get(`/api/threads${cursor(first)}`)).json(),
  );

  const third = threadPageSchema.parse(
    await (await owner.get(`/api/threads${cursor(second)}`)).json(),
  );

  expect(second.threads).toHaveLength(7);
  expect(second.counts).toEqual(first.counts);
  expect(third.threads).toHaveLength(3);
  expect(third.counts).toEqual(first.counts);
  expect(third.nextCursor).toBeNull();

  const seen = [first, second, third].flatMap((page) => page.threads.map((thread) => thread.id));

  expect(seen).toHaveLength(60);
  expect(new Set(seen).size).toBe(60);

  const rejected = await Promise.all(
    ["?limit=0", "?limit=201", "?limit=many", "?beforeId=thread-1"].map(async (query) => {
      const response = await owner.get(`/api/threads${query}`);

      return { body: invalidRequestSchema.parse(await response.json()), status: response.status() };
    }),
  );

  for (const result of rejected) {
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_request");
  }

  await owner.dispose();
});
