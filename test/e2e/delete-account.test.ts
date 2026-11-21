import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { BrowserUseFixture } from "./browser-use-server.fixture.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const mailboxSchema = z.object({ address: z.string(), forwardingWorks: z.boolean() });

async function repeat(times: number, attempt: () => Promise<void>) {
  if (times === 0) {
    return;
  }

  await attempt();
  await repeat(times - 1, attempt);
}

interface DeleteHarness {
  browserUse: BrowserUseFixture;
  objectRoot: string;
  server: AppServer;
}

async function startHarness(identityServer: IdentityServer) {
  const directory = mkdtempSync(join(tmpdir(), "overture-delete-account-"));
  const objectRoot = join(directory, "objects");
  const browserUse = startBrowserUseFixture();

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "browser_use",
    BROWSER_USE_API_BASE_URL: browserUse.url,
    BROWSER_USE_API_KEY: "delete-account-test-key",
    INBOUND_HMAC_SECRET: "delete-account-hmac-secret",
    OBJECT_STORE_ROOT: objectRoot,
  });

  return { browserUse, objectRoot, server };
}

async function stopHarness(harness: DeleteHarness) {
  await harness.server.stop();
  harness.browserUse.close();
}

async function signInOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
  await request.put(`${appServerUrl}/__test__/settings/jobs.poll_interval_ms`, {
    data: { value: "3600000" },
  });

  const state = await verifyAuthState(appServerUrl, request);
  const userId = state.users.find((user) => user.email === authTestIdentity.ownerEmail)?.id ?? "";

  expect(userId).not.toBe("");

  return userId;
}

async function seedPersonalData(request: APIRequestContext, server: DeleteHarness, userId: string) {
  await request.put("/api/profile/facts", {
    data: { facts: [{ key: "legal_name", value: "Maya Okafor", scope: "" }] },
  });
  await request.put("/api/profile/targets", {
    data: {
      employmentTypes: ["full_time"],
      locations: ["Toronto, ON"],
      roles: ["Senior Backend Engineer"],
      salaryCurrency: "CAD",
      salaryFloorMinor: 1_000_000,
      salaryPeriod: "year",
      seniorities: ["senior"],
      workplaces: ["remote"],
    },
  });
  await request.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });
  await request.post("/__test__/ledger/sample", { data: { email: authTestIdentity.ownerEmail } });

  const profileResponse = await request.post(`${server.browserUse.url}/api/v4/profiles`, {
    data: { name: "Maya", userId },
  });

  const profile = z.object({ id: z.string() }).parse(await profileResponse.json());

  const database = new DatabaseSync(server.server.databasePath);

  database.exec("PRAGMA busy_timeout = 5000;");

  const seededAt = Math.floor(Date.UTC(2026, 10, 21) / 1000);

  try {
    database
      .prepare(
        "INSERT INTO browser_profiles (user_id, provider, provider_profile_id, country_code, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(userId, "browser_use", profile.id, "ca", seededAt, seededAt);

    database
      .prepare(
        "INSERT INTO admin_audit (id, at, actor_id, action, target_user_id, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        crypto.randomUUID(),
        Date.UTC(2026, 10, 21),
        "owner",
        "account.open",
        userId,
        "support request",
        "{}",
      );
    database
      .prepare(
        "INSERT INTO profiles (user_id, running, pause_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET running = 1, pause_reason = NULL, updated_at = excluded.updated_at",
      )
      .run(userId, 1, null, seededAt, seededAt);
    database
      .prepare("INSERT INTO events (user_id, topic, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, "test.event", "{}", seededAt);
    database
      .prepare(
        "INSERT INTO llm_usage (id, user_id, purpose, model, input_tokens, cached_tokens, output_tokens, cost_micros, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(crypto.randomUUID(), userId, "test", "test-model", 0, 0, 0, 0, seededAt);
  } finally {
    database.close();
  }

  mkdirSync(join(server.objectRoot, "mail", userId, "attachments"), { recursive: true });
  writeFileSync(join(server.objectRoot, "mail", userId, "attachments", "letter.pdf"), "sealed");

  return profile.id;
}

async function moveClockAhead(request: APIRequestContext, milliseconds: number) {
  const current = z
    .object({ offsetMs: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  await requestClockOffset(request, current.offsetMs + milliseconds);
}

async function requestClockOffset(request: APIRequestContext, offsetMs: number) {
  await request.post("/__test__/clock/offset", { data: { offsetMs } });
}

async function runErasure(appServerUrl: string, request: APIRequestContext, userId: string) {
  const response = await request.post(`${appServerUrl}/__test__/jobs/run-now`, {
    data: { kind: "account.erase", payload: JSON.stringify({ userId }) },
  });

  expect(response.ok()).toBe(true);
}

async function runDueJobs(appServerUrl: string, request: APIRequestContext) {
  const response = await request.post(`${appServerUrl}/__test__/jobs/run-due`);

  expect(response.ok()).toBe(true);
}

function counts(server: AppServer, userId: string) {
  const database = new DatabaseSync(server.databasePath, { readOnly: true });
  database.exec("PRAGMA busy_timeout = 5000;");

  const n = (statement: string, ...params: string[]) =>
    z.object({ n: z.number() }).parse(database.prepare(statement).get(...params)).n;

  const result = {
    adminAudit: n("SELECT COUNT(*) AS n FROM admin_audit WHERE target_user_id = ?", userId),
    applications: n("SELECT COUNT(*) AS n FROM applications WHERE user_id = ?", userId),
    browserProfiles: n("SELECT COUNT(*) AS n FROM browser_profiles WHERE user_id = ?", userId),
    events: n("SELECT COUNT(*) AS n FROM events WHERE user_id = ?", userId),
    facts: n("SELECT COUNT(*) AS n FROM facts WHERE user_id = ?", userId),
    llmUsage: n("SELECT COUNT(*) AS n FROM llm_usage WHERE user_id = ?", userId),
    messages: n("SELECT COUNT(*) AS n FROM messages WHERE user_id = ?", userId),
    sessions: n("SELECT COUNT(*) AS n FROM session WHERE user_id = ?", userId),
    userKeys: n("SELECT COUNT(*) AS n FROM user_keys WHERE user_id = ?", userId),
    users: n("SELECT COUNT(*) AS n FROM users WHERE id = ?", userId),
  };

  database.close();

  return result;
}

function filesUnder(directory: string) {
  if (!existsSync(directory)) {
    return 0;
  }

  return readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  ).length;
}

function retiredAddresses(server: AppServer) {
  const database = new DatabaseSync(server.databasePath, { readOnly: true });
  database.exec("PRAGMA busy_timeout = 5000;");

  const rows = z
    .object({ local_part: z.string() })
    .array()
    .parse(database.prepare("SELECT local_part FROM retired_addresses").all());

  database.close();

  return rows.map((row) => row.local_part);
}

function lockState(server: AppServer, userId: string) {
  const database = new DatabaseSync(server.databasePath, { readOnly: true });
  database.exec("PRAGMA busy_timeout = 5000;");

  const row = database
    .prepare(
      "SELECT u.suspended_at, p.pause_reason, p.running, (SELECT COUNT(*) FROM session s WHERE s.user_id = u.id) AS sessions FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?",
    )
    .get(userId);

  database.close();

  if (row === undefined) {
    return null;
  }

  const state = z
    .object({
      pause_reason: z.string().nullable(),
      running: z.number().nullable(),
      sessions: z.number(),
      suspended_at: z.number().nullable(),
    })
    .parse(row);

  if (state.pause_reason === null || state.running === null) {
    return null;
  }

  return {
    paused: state.pause_reason === "suspended",
    running: state.running === 1,
    sessions: state.sessions,
    suspended: state.suspended_at !== null,
  };
}

async function openDeletePage(page: Page, appServerUrl: string) {
  await page.goto(`${appServerUrl}/settings`);
  await page.getByRole("link", { name: "Delete account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
}

test("a fresh signed-in session still needs a recent sign-in, then deletes everything", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const owner = await apiRequest.newContext({ baseURL: harness.server.url });
    const userId = await signInOwner(owner, harness.server.url);
    const profileId = await seedPersonalData(owner, harness, userId);

    const mailboxResponse = await owner.get("/api/profile/mailbox");

    expect(mailboxResponse.ok()).toBe(true);

    const mailbox = mailboxSchema.parse(await mailboxResponse.json());

    const localPart = mailbox.address.split("@")[0] ?? "";

    const deletionState = await owner.get("/api/account/deletion");

    expect(deletionState.headers()["cache-control"]).toBe("no-store");

    await moveClockAhead(owner, 20 * 60_000);

    const refused = await owner.post("/api/account/delete", { data: { confirm: true } });

    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "reauth_required" });

    const linkResponse = await owner.post("/api/account/reauth/link");

    expect(linkResponse.ok()).toBe(true);

    const link = await latestMailLink(harness.server.url, owner, authTestIdentity.ownerEmail);

    await owner.get(link);
    await requestClockOffset(owner, 0);

    const accepted = await owner.post("/api/account/delete", { data: { confirm: true } });

    expect(accepted.status()).toBe(202);
    expect(await accepted.json()).toMatchObject({ status: "erasing" });

    const locked = lockState(harness.server, userId);

    if (locked !== null) {
      expect(locked.suspended).toBe(true);
      expect(locked.paused).toBe(true);
      expect(locked.running).toBe(false);
      expect(locked.sessions).toBe(0);
    }

    await runErasure(harness.server.url, owner, userId);
    await runDueJobs(harness.server.url, owner);

    const after = counts(harness.server, userId);

    expect(after).toEqual({
      adminAudit: 1,
      applications: 0,
      browserProfiles: 0,
      events: 0,
      facts: 0,
      llmUsage: 0,
      messages: 0,
      sessions: 0,
      userKeys: 0,
      users: 0,
    });
    expect(harness.browserUse.deletedProfileIds).toContain(profileId);
    expect(retiredAddresses(harness.server)).toContain(localPart);

    for (const prefix of ["files", "mail", "exports"]) {
      expect(filesUnder(join(harness.objectRoot, prefix, userId))).toBe(0);
    }

    const sent = z
      .object({
        messages: z.array(z.object({ body: z.string(), subject: z.string(), to: z.string() })),
      })
      .parse(await (await owner.get("/__test__/mail")).json());

    const confirmation = sent.messages.findLast(
      (message) =>
        message.to === authTestIdentity.ownerEmail &&
        message.subject === "Your Overture account has been deleted",
    );

    expect(confirmation?.body).toContain("Hi Maya,");
    expect(confirmation?.body).toContain("write to admin@tryoverture.com");

    const secondRun = await owner.post(`${harness.server.url}/__test__/jobs/run-now`, {
      data: { kind: "account.erase", payload: JSON.stringify({ userId }) },
    });

    expect(secondRun.ok()).toBe(true);
    expect(counts(harness.server, userId)).toEqual(after);

    const afterSecondRun = z
      .object({
        messages: z.array(z.object({ subject: z.string(), to: z.string() })),
      })
      .parse(await (await owner.get("/__test__/mail")).json());

    expect(
      afterSecondRun.messages.filter(
        (message) =>
          message.to === authTestIdentity.ownerEmail &&
          message.subject === "Your Overture account has been deleted",
      ),
    ).toHaveLength(1);

    await owner.dispose();
  } finally {
    await stopHarness(harness);
  }
});

test("unauthenticated account calls are refused before body validation", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const request = await apiRequest.newContext({ baseURL: harness.server.url });

    expect((await request.post("/api/account/reauth/link")).status()).toBe(401);
    expect((await request.post("/api/account/delete", { data: {} })).status()).toBe(401);
    expect((await request.get("/api/account/deletion")).status()).toBe(401);

    await request.dispose();
  } finally {
    await stopHarness(harness);
  }
});

test("there is no password re-auth, and the sign-in link ask is limited to three", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const request = await apiRequest.newContext({ baseURL: harness.server.url });

    await signInOwner(request, harness.server.url);
    await moveClockAhead(request, 20 * 60_000);

    const password = await request.post("/api/account/reauth", {
      data: { password: "overture-delete-pass-813" },
    });

    expect(password.ok()).toBe(false);
    expect(await (await request.get("/api/account/deletion")).json()).toEqual({
      email: authTestIdentity.ownerEmail,
      reauthenticated: false,
    });

    await repeat(3, async () => {
      expect((await request.post("/api/account/reauth/link")).ok()).toBe(true);
    });

    expect((await request.post("/api/account/reauth/link")).status()).toBe(429);

    await request.dispose();
  } finally {
    await stopHarness(harness);
  }
});

test("a failing confirmation mail never blocks the erase", async ({ identityServer }) => {
  const harness = await startHarness(identityServer);

  try {
    const owner = await apiRequest.newContext({ baseURL: harness.server.url });
    const userId = await signInOwner(owner, harness.server.url);

    await seedPersonalData(owner, harness, userId);

    const failing = await owner.post("/__test__/mail/fail-next", { data: { count: 1 } });

    expect(failing.ok()).toBe(true);

    const accepted = await owner.post("/api/account/delete", { data: { confirm: true } });

    expect(accepted.status()).toBe(202);

    await runErasure(harness.server.url, owner, userId);

    const after = counts(harness.server, userId);

    expect(after).toEqual({
      adminAudit: 1,
      applications: 0,
      browserProfiles: 0,
      events: 0,
      facts: 0,
      llmUsage: 0,
      messages: 0,
      sessions: 0,
      userKeys: 0,
      users: 0,
    });

    const jobs = z
      .object({ jobs: z.array(z.object({ kind: z.string(), status: z.string() })) })
      .parse(await (await owner.get("/__test__/jobs")).json());

    expect(jobs.jobs.some((job) => job.kind === "account.deleted.notice")).toBe(true);

    const sent = z
      .object({
        messages: z.array(z.object({ subject: z.string(), to: z.string() })),
      })
      .parse(await (await owner.get("/__test__/mail")).json());

    expect(
      sent.messages.filter(
        (message) =>
          message.to === authTestIdentity.ownerEmail &&
          message.subject === "Your Overture account has been deleted",
      ),
    ).toHaveLength(0);

    await owner.dispose();
  } finally {
    await stopHarness(harness);
  }
});

test("the delete page needs a check, asks for a sign-in link, and shows the erasing states", async ({
  identityServer,
  browser,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const request = await apiRequest.newContext({ baseURL: harness.server.url });
    const userId = await signInOwner(request, harness.server.url);

    await seedPersonalData(request, harness, userId);
    await moveClockAhead(request, 20 * 60_000);

    const storage = await request.storageState();
    const context = await browser.newContext({ storageState: storage });
    const page = await context.newPage();

    await openDeletePage(page, harness.server.url);

    const { violations } = await new AxeBuilder({ page }).analyze();

    expect(violations).toEqual([]);

    await expect(page.getByText("This erases everything")).toBeVisible();

    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Tick the box to confirm you understand what is erased.",
    );
    await expect(page.getByText("Erasing your account")).toHaveCount(0);

    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("A sign-in link is on its way.")).toBeVisible();

    const link = await latestMailLink(harness.server.url, request, authTestIdentity.ownerEmail);

    await page.goto(link);
    await requestClockOffset(request, 0);
    await page.goto(`${harness.server.url}/settings/delete`);

    await page.getByLabel("I understand my data is erased").check();
    await page.getByRole("button", { name: "Delete my account" }).click();

    await expect(page.getByText("Erasing your account")).toBeVisible();
    await expect(page.getByText("What arrives when it is done")).toBeVisible();
    await expect(page.getByText("Hi Maya,")).toBeVisible();
    await expect(page.getByText("write to admin@tryoverture.com")).toBeVisible();

    await context.close();
    await request.dispose();
  } finally {
    await stopHarness(harness);
  }
});
