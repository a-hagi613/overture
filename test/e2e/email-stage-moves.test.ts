import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { APIRequestContext, Browser } from "@playwright/test";
import { dkimSign } from "mailauth";
import { z } from "zod";

import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { AppServer } from "./app-server.ts";

import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
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

const SECRET = "e2e-email-stage-secret-0123456789";
const SELECTOR = "overture";
const SIGNING_DOMAINS = ["acme.example", "us.greenhouse-mail.io", "personio.de"] as const;

type SigningDomain = (typeof SIGNING_DOMAINS)[number];

interface MovesHarness {
  server: AppServer;
  anthropic: AnthropicFixtureServer;
  sign: (raw: string, domain: SigningDomain) => Promise<string>;
}

const test = appTest.extend<{ moves: MovesHarness }>({
  moves: [
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

      const anthropic = await startAnthropicFixtureServer();

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        INBOUND_DNS_SERVER: dns.server,
        INBOUND_HMAC_SECRET: SECRET,
        MAIL_DOMAIN: "tryoverture.com",
      });

      await provide({
        anthropic,
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
      anthropic.stop();
      await dns.stop();
    },
    { scope: "test" },
  ],
});

const mailboxSchema = z.object({ address: z.string() });

const clockSchema = z.object({ now: z.number() });

const detailSchema = z.object({
  application: z.object({
    closedReason: z.string().nullable(),
    stage: z.string().nullable(),
    stageLocked: z.boolean(),
    status: z.string(),
  }),
});

const boardSchema = z.object({
  columns: z.array(
    z.object({
      cards: z.array(z.object({ id: z.string(), stage: z.string().nullable() })),
      stage: z.string(),
    }),
  ),
});

const messageSchema = z.object({
  auth: z.string(),
  classification: z.string().nullable(),
  subject: z.string(),
});

const messagesSchema = z.object({ messages: z.array(messageSchema) });

const usageSchema = z.object({
  totals: z.object({ calls: z.number(), costMicros: z.number() }),
});

function fixture(name: string) {
  return readFileSync(join(process.cwd(), "test/e2e/fixtures/mail", name), "utf8");
}

function fresh(raw: string) {
  return raw
    .replaceAll("__MESSAGE_ID__", crypto.randomUUID())
    .replaceAll("__ACK_ID__", crypto.randomUUID());
}

async function mailboxAddress(owner: APIRequestContext) {
  return mailboxSchema.parse(await (await owner.get("/api/profile/mailbox")).json()).address;
}

async function forward(
  moves: MovesHarness,
  owner: APIRequestContext,
  raw: string,
  address: string,
  domain: SigningDomain,
) {
  const body = new TextEncoder().encode(await moves.sign(raw, domain));

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

async function runJobs(owner: APIRequestContext) {
  const response = await owner.post("/__test__/jobs/run-due");

  expect(response.ok()).toBe(true);
}

const jobsSchema = z.object({
  jobs: z.array(z.object({ kind: z.string(), status: z.string() })),
});

async function runMailJobs(owner: APIRequestContext) {
  await runJobs(owner);
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

async function applicationDetail(owner: APIRequestContext, id: string) {
  return detailSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(id)}`)).json(),
  ).application;
}

async function boardStage(owner: APIRequestContext, id: string) {
  const board = boardSchema.parse(await (await owner.get("/api/board")).json());

  return board.columns.flatMap((column) => column.cards).find((card) => card.id === id) ?? null;
}

async function storedMessage(owner: APIRequestContext, mailboxId: string) {
  const rows = messagesSchema.parse(
    await (
      await owner.get(`/__test__/mail/messages?mailboxId=${encodeURIComponent(mailboxId)}`)
    ).json(),
  ).messages;

  return rows.at(-1) ?? null;
}

async function mailboxIdFor(owner: APIRequestContext, userId: string) {
  const id = z
    .object({ mailboxes: z.array(z.object({ id: z.string() })) })
    .parse(
      await (await owner.get(`/__test__/mailboxes?userId=${encodeURIComponent(userId)}`)).json(),
    ).mailboxes[0]?.id;

  if (id === undefined) {
    throw new Error("the owner has no forwarding address");
  }

  return id;
}

async function waitForStage(owner: APIRequestContext, id: string, stage: string) {
  await expect
    .poll(async () => (await applicationDetail(owner, id)).stage, { timeout: 20_000 })
    .toBe(stage);
}

async function seed(owner: APIRequestContext, userId: string) {
  const companyId = await seedCompany(owner, "Acme", "acme.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "acme");

  const postingId = await seedPosting(owner, {
    atsJobId: "acme-1",
    boardId,
    companyId,
    title: "Senior Backend Engineer",
    url: "https://acme.example/1",
  });

  return seedApplication(owner, {
    postingId,
    sentAt: Date.UTC(2026, 10, 19, 15, 0, 0),
    status: "sent",
    userId,
  });
}

async function openBoard(
  browser: Browser,
  appServerUrl: string,
  storage: Awaited<ReturnType<APIRequestContext["storageState"]>>,
) {
  const context = await browser.newContext({
    storageState: storage,
    timezoneId: "America/Toronto",
  });

  const page = await context.newPage();

  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto(`${appServerUrl}/board`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  return { context, page };
}

test("a rejection and an interview move the card, Undo restores it, and a hand move stays", async ({
  browser,
  moves,
}) => {
  const { owner, userId } = await ownerContextFor(moves.server.url);
  const applicationId = await seed(owner, userId);
  const address = await mailboxAddress(owner);
  const storage = await owner.storageState();
  const { context, page } = await openBoard(browser, moves.server.url, storage);

  const appliedCard = page.locator(
    `section[aria-label="Applied"] button[data-card="${applicationId}"]`,
  );

  await expect(appliedCard).toBeVisible();

  await forward(
    moves,
    owner,
    fresh(fixture("greenhouse-rejection.eml")),
    address,
    "us.greenhouse-mail.io",
  );
  await runMailJobs(owner);

  await expect(
    page.locator(`section[aria-label="Closed"] button[data-card="${applicationId}"]`),
  ).toBeVisible();
  await expect(page.getByText("Moved to Closed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  expect((await applicationDetail(owner, applicationId)).closedReason).toBe("rejected");

  await page.getByRole("button", { name: "Undo" }).click();

  await expect(appliedCard).toBeVisible();
  await expect(
    page.locator(`section[aria-label="Closed"] button[data-card="${applicationId}"]`),
  ).toHaveCount(0);

  const restored = await applicationDetail(owner, applicationId);

  expect(restored.stage).toBe("applied");
  expect(restored.closedReason).toBeNull();

  await forward(
    moves,
    owner,
    fresh(fixture("greenhouse-interview.eml")),
    address,
    "us.greenhouse-mail.io",
  );
  await runMailJobs(owner);

  await expect(page.getByText("Moved to Interviewing")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(
    page
      .locator(`section[aria-label="Waiting"] button[data-card="${applicationId}"]`)
      .getByText("Interviewing", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(appliedCard).toBeVisible();

  const moved = page.locator(`section[aria-label="Applied"] button[data-card="${applicationId}"]`);

  const drag = page.waitForResponse(
    (candidate) => candidate.request().method() === "PATCH" && candidate.url().includes("/stage"),
  );

  await moved.dragTo(page.locator('section[aria-label="Waiting"]'));
  await drag;

  await expect(
    page
      .locator(`section[aria-label="Waiting"] button[data-card="${applicationId}"]`)
      .getByText("Screening", { exact: true }),
  ).toBeVisible();

  await forward(
    moves,
    owner,
    fresh(fixture("greenhouse-interview.eml")),
    address,
    "us.greenhouse-mail.io",
  );
  await runMailJobs(owner);

  const afterEmail = await applicationDetail(owner, applicationId);

  expect(afterEmail.stage).toBe("screening");
  expect(afterEmail.stageLocked).toBe(true);
  expect((await boardStage(owner, applicationId))?.stage).toBe("screening");

  await context.close();
  await owner.dispose();
});

test("failed-auth mail is stored and never moves a card", async ({ moves }) => {
  const { owner, userId } = await ownerContextFor(moves.server.url);
  const applicationId = await seed(owner, userId);
  const address = await mailboxAddress(owner);

  const mailboxId = await mailboxIdFor(owner, userId);

  const raw = fresh(fixture("greenhouse-rejection.eml"));
  const body = new TextEncoder().encode(raw);

  const timestamp = Math.trunc(
    clockSchema.parse(await (await owner.get("/__test__/clock")).json()).now / 1000,
  );

  const signed = await signInbound(SECRET, { body, rcptTo: address, timestamp });

  const posted = await owner.post("/internal/mail/inbound", {
    data: Buffer.from(body),
    headers: {
      [INBOUND_HEADERS.mailFrom]: "owner@forwarder.test",
      [INBOUND_HEADERS.rcptTo]: address,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      "content-type": "message/rfc822",
    },
  });

  expect(posted.status()).toBe(204);

  await runMailJobs(owner);

  const stored = await storedMessage(owner, mailboxId);

  if (stored === null) {
    throw new Error("the failed-auth message was not stored");
  }

  expect(stored.auth).not.toBe("pass");
  expect((await applicationDetail(owner, applicationId)).stage).toBe("applied");

  await owner.dispose();
});

test("a German rejection moves to Closed and the rules call no model", async ({ moves }) => {
  const { owner, userId } = await ownerContextFor(moves.server.url);
  const applicationId = await seed(owner, userId);
  const address = await mailboxAddress(owner);

  await forward(moves, owner, fresh(fixture("personio-rejection.eml")), address, "personio.de");
  await runMailJobs(owner);
  await waitForStage(owner, applicationId, "closed");

  const detail = await applicationDetail(owner, applicationId);

  expect(detail.closedReason).toBe("rejected");
  expect(moves.anthropic.batchesCreated()).toBe(0);

  await owner.dispose();
});

test("Haiku classifies unsure mail and its cost is recorded", async ({ moves }) => {
  const { owner, userId } = await ownerContextFor(moves.server.url);
  const applicationId = await seed(owner, userId);
  const address = await mailboxAddress(owner);

  await forward(
    moves,
    owner,
    fresh(fixture("greenhouse-unclear.eml")),
    address,
    "us.greenhouse-mail.io",
  );
  await runMailJobs(owner);
  await waitForStage(owner, applicationId, "interviewing");

  expect(moves.anthropic.batchesCreated()).toBe(1);
  expect(moves.anthropic.requests()).toHaveLength(1);
  expect(moves.anthropic.requests()[0]?.kind).toBe("email_classify");

  const usage = usageSchema.parse(
    await (await owner.get("/__test__/llm/usage?purpose=email_classify")).json(),
  );

  expect(usage.totals.calls).toBe(1);
  expect(usage.totals.costMicros).toBeGreaterThan(0);

  await owner.dispose();
});

test("a degraded flag makes mail classification rules-only and logs it", async ({ moves }) => {
  const { owner, userId } = await ownerContextFor(moves.server.url);
  const applicationId = await seed(owner, userId);
  const address = await mailboxAddress(owner);

  const objects = join(dirname(moves.server.databasePath), "objects");

  mkdirSync(join(objects, "ops"), { recursive: true });
  writeFileSync(
    join(objects, "ops/degraded.json"),
    JSON.stringify({
      version: 1,
      degraded: true,
      since: "2026-11-21T15:00:00.000Z",
      metrics: [
        {
          metric: "r2.class_a_operations",
          used: 950_000,
          allowance: 1_000_000,
          share: 0.95,
        },
      ],
    }),
  );

  await forward(
    moves,
    owner,
    fresh(fixture("greenhouse-unclear.eml")),
    address,
    "us.greenhouse-mail.io",
  );
  await runMailJobs(owner);

  expect(moves.anthropic.batchesCreated()).toBe(0);
  expect((await applicationDetail(owner, applicationId)).stage).toBe("applied");

  const enabled = await moves.server.waitForStderr(/^overture degraded: enabled since/u);

  expect(enabled).toContain("r2.class_a_operations at 95%");

  const skipped = await moves.server.waitForStderr(
    /^overture degraded: email_classify skipped while degraded/u,
  );

  expect(skipped).toContain("rules only");

  await owner.dispose();
});

const RECORDED_MAIL = [
  {
    domain: "acme.example",
    file: "acme-reply.eml",
    label: "other",
    subject: "A quick note about your application",
  },
  {
    domain: "us.greenhouse-mail.io",
    file: "greenhouse-ack.eml",
    label: "ack",
    subject: "Your application to Acme",
  },
  {
    domain: "us.greenhouse-mail.io",
    file: "greenhouse-code.eml",
    label: "code",
    subject: "Your application to Acme needs a security code",
  },
  {
    domain: "us.greenhouse-mail.io",
    file: "greenhouse-interview-brief.eml",
    label: "interview",
    subject: "Interview with Acme: the brief",
  },
  {
    domain: "us.greenhouse-mail.io",
    file: "greenhouse-interview.eml",
    label: "interview",
    subject: "Interview with Acme",
  },
  {
    domain: "us.greenhouse-mail.io",
    file: "greenhouse-offer.eml",
    label: "offer",
    subject: "Your offer from Acme",
  },
  {
    domain: "us.greenhouse-mail.io",
    file: "greenhouse-rejection.eml",
    label: "rejection",
    subject: "Update on your application to Acme",
  },
  {
    domain: "us.greenhouse-mail.io",
    file: "greenhouse-unclear.eml",
    label: "interview",
    subject: "Next steps with your application at Acme",
  },
  {
    domain: "personio.de",
    file: "personio-rejection.eml",
    label: "rejection",
    subject: "Ihre Bewerbung bei Acme",
  },
] as const;

test("every recorded mail fixture keeps the label the research table records", async ({
  moves,
}) => {
  const { owner, userId } = await ownerContextFor(moves.server.url);
  await seed(owner, userId);
  const address = await mailboxAddress(owner);
  const mailboxId = await mailboxIdFor(owner, userId);

  await Promise.all(
    RECORDED_MAIL.map(async (row) => {
      await forward(moves, owner, fresh(fixture(row.file)), address, row.domain);
    }),
  );
  await runMailJobs(owner);

  const listed = messagesSchema.parse(
    await (
      await owner.get(`/__test__/mail/messages?mailboxId=${encodeURIComponent(mailboxId)}`)
    ).json(),
  ).messages;

  expect(new Map(listed.map((message) => [message.subject, message.classification]))).toEqual(
    new Map(RECORDED_MAIL.map((row) => [row.subject, row.label])),
  );

  await owner.dispose();
});
