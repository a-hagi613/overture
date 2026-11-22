import { readFileSync } from "node:fs";

import { DatabaseSync } from "node:sqlite";

import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { BrowserUseFixture } from "./browser-use-server.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import {
  configureMatching,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import {
  latestMailLink,
  requestMagicLink,
  setTurnstileScenario,
  verifyAuthState,
} from "./sign-in.ts";

const NEW_EMAIL = "new.person@example.com";
const EXISTING_EMAIL = "existing.m2@example.com";
const SCANNED_RESUME = new Uint8Array(readFileSync("test/e2e/fixtures/resume-scanned.pdf"));
const TEXT_RESUME = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const onboardingSchema = z.object({
  needsOnboarding: z.boolean(),
  onboardedAt: z.string().nullable(),
  step: z.number(),
});

const homeSchema = z.object({ applicationsLeft: z.number(), planApplications: z.number() });

const applicationsLeftSchema = z.object({ applicationsLeft: z.number() });

const resumeSchema = z.object({
  bytes: z.number(),
  parsedWith: z.enum(["unpdf", "llm"]),
  unreadable: z.boolean(),
});

const authStateSchema = z.object({
  users: z.array(z.object({ email: z.string(), id: z.string(), role: z.string() })),
});

const notificationsSchema = z.object({
  notifications: z.array(z.object({ kind: z.string(), title: z.string() })),
});

const appStatusSchema = z.object({
  application: z.object({ status: z.string(), statusReason: z.string().nullable() }),
});

const postingSchema = z.object({
  applicationId: z.string().nullable(),
  reason: z.string().nullable(),
  score: z.number().nullable(),
});

interface PublicFixtures {
  anthropic: AnthropicFixtureServer;
  browserUse: BrowserUseFixture;
  publicServer: AppServer;
  publicUrl: string;
}

const publicTest = appTest.extend<PublicFixtures>({
  anthropic: async ({ browser: _browser }, provide) => {
    const anthropic = await startAnthropicFixtureServer();

    await provide(anthropic);
    anthropic.stop();
  },
  browserUse: async ({ browser: _browser }, provide) => {
    const browserUse = startBrowserUseFixture();

    await provide(browserUse);
    browserUse.close();
  },
  publicServer: [
    async ({ anthropic, browserUse, identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        BROWSER_PROVIDER: "browser_use",
        BROWSER_PROXY_COUNTRY: "ca",
        BROWSER_USE_API_BASE_URL: browserUse.url,
        BROWSER_USE_API_KEY: "public-signup-test-key",
        PUBLIC_SIGNUP_ENABLED: "true",
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
  publicUrl: async ({ publicServer }, provide) => {
    await provide(publicServer.url);
  },
});

async function signInNewEmail(appServerUrl: string, email: string) {
  const context = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, context, email);

  const link = await latestMailLink(appServerUrl, context, email);

  await context.get(link);

  const state = authStateSchema.parse(
    await (await context.get(`${appServerUrl}/__test__/auth/state`)).json(),
  );

  const user = state.users.find((candidate) => candidate.email === email);

  if (user === undefined) {
    throw new Error(`signing up ${email} created no user`);
  }

  return { context, userId: user.id };
}

async function uploadResume(context: APIRequestContext, bytes = SCANNED_RESUME) {
  const response = await context.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(bytes),
        mimeType: "application/pdf",
        name: "resume.pdf",
      },
    },
  });

  expect(response.status()).toBe(201);

  return resumeSchema.parse(await response.json());
}

function llmUsageRows(server: AppServer) {
  const sqlite = new DatabaseSync(server.databasePath, { readOnly: true });
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  try {
    return z
      .array(z.object({ cost_micros: z.number(), purpose: z.string() }))
      .parse(sqlite.prepare("select purpose, cost_micros from llm_usage").all());
  } finally {
    sqlite.close();
  }
}

function grantRows(server: AppServer, userId: string) {
  const sqlite = new DatabaseSync(server.databasePath, { readOnly: true });
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  try {
    return z
      .array(z.object({ quantity: z.number(), source: z.string() }))
      .parse(sqlite.prepare("select quantity, source from grants where user_id = ?").all(userId));
  } finally {
    sqlite.close();
  }
}

publicTest.describe("public sign-up with spend protection", () => {
  publicTest(
    "an unknown email signs up by magic link and reaches onboarding with no spend",
    async ({ page, publicServer, publicUrl }) => {
      await page.goto(`${publicUrl}/signin`);
      await page.getByLabel("Email").fill(NEW_EMAIL);
      await page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await expect(page.getByText("Link sent to")).toBeVisible();

      const link = await latestMailLink(publicUrl, page.request, NEW_EMAIL);

      await page.goto(link);
      await expect(page.getByRole("heading", { name: /Welcome to Overture/u })).toBeVisible();

      const state = onboardingSchema.parse(
        await (await page.request.get(`${publicUrl}/api/onboarding`)).json(),
      );

      expect(state.needsOnboarding).toBe(true);
      expect(state.step).toBe(1);

      const home = homeSchema.parse(await (await page.request.get(`${publicUrl}/api/home`)).json());

      expect(home.applicationsLeft).toBe(0);
      expect(home.planApplications).toBe(0);

      const authState = authStateSchema.parse(
        await (await page.request.get(`${publicUrl}/__test__/auth/state`)).json(),
      );

      const created = authState.users.find((user) => user.email === NEW_EMAIL);

      expect(created?.role).toBe("user");
      expect(grantRows(publicServer, created?.id ?? "")).toEqual([]);
      expect(llmUsageRows(publicServer)).toEqual([]);
    },
  );

  publicTest(
    "an unknown email signs up with Google and reaches onboarding",
    async ({ identityServer, page, request, publicUrl }) => {
      const googleEmail = "public.google@example.com";

      await identityServer.setPersona({
        email: googleEmail,
        emailVerified: true,
        name: "Public Google",
        picture: null,
        sub: "public-google",
      });
      await setTurnstileScenario(request, publicUrl, { action: "signin" });
      await page.goto(`${publicUrl}/signin`);
      await page.getByRole("button", { name: "Continue with Google" }).click();
      await expect(page.getByRole("heading", { name: /Welcome to Overture/u })).toBeVisible();

      const state = await verifyAuthState(publicUrl, request);

      expect(state.users.find((user) => user.email === googleEmail)?.emailVerified).toBe(true);
    },
  );

  publicTest(
    "a scanned resume costs no LLM call until Applications exist, then it may",
    async ({ anthropic, publicServer, publicUrl }) => {
      const { context } = await signInNewEmail(publicUrl, NEW_EMAIL);

      const blocked = await uploadResume(context);

      expect(blocked.parsedWith).toBe("unpdf");
      expect(blocked.unreadable).toBe(true);
      expect(anthropic.singleMessages()).toEqual([]);
      expect(llmUsageRows(publicServer)).toEqual([]);

      const granted = await context.post("/__test__/ledger/grant", {
        data: { email: NEW_EMAIL, idempotencyKey: "public-signup-trial", quantity: 3 },
      });

      expect(applicationsLeftSchema.parse(await granted.json()).applicationsLeft).toBe(3);

      const allowed = await uploadResume(context);

      expect(allowed.parsedWith).toBe("llm");
      expect(allowed.unreadable).toBe(false);
      expect(anthropic.singleMessages()).toHaveLength(1);
      expect(llmUsageRows(publicServer)).toHaveLength(1);

      await context.dispose();
    },
  );

  publicTest(
    "preparation does not begin and spends nothing before the trial card or a plan",
    async ({ anthropic, browserUse, publicServer, publicUrl }) => {
      const { context, userId } = await signInNewEmail(publicUrl, EXISTING_EMAIL);

      const companyId = await seedCompany(context, "Spend Gate Co", "spend-gate.example");
      const boardId = await seedBoard(context, companyId, "greenhouse", "spend-gate");

      const postingId = await seedPosting(context, {
        atsJobId: "spend-gate-1",
        boardId,
        companyId,
        url: "https://spend-gate.example/jobs/1",
      });

      const applicationId = await seedApplication(context, {
        postingId,
        status: "preparing",
        userId,
      });

      const run = await context.post("/__test__/jobs/run-now", {
        data: {
          kind: "application.prepare",
          payload: JSON.stringify({ applicationId }),
        },
      });

      expect(run.ok()).toBe(true);

      const status = appStatusSchema.parse(
        await (await context.get(`/api/applications/${applicationId}`)).json(),
      );

      expect(status.application.status).toBe("preparing");
      expect(anthropic.batchesCreated()).toBe(0);
      expect(anthropic.singleMessages()).toEqual([]);
      expect(browserUse.sessions).toEqual([]);
      expect(llmUsageRows(publicServer)).toEqual([]);

      await context.dispose();
    },
  );

  publicTest(
    "opening a posting spends nothing before the trial card or a plan",
    async ({ anthropic, publicServer, publicUrl }) => {
      const { context } = await signInNewEmail(publicUrl, EXISTING_EMAIL);

      await configureMatching(context);
      await uploadResume(context, TEXT_RESUME);

      const companyId = await seedCompany(context, "Open Gate Co", "open-gate.example");
      const boardId = await seedBoard(context, companyId, "greenhouse", "open-gate");

      const postingId = await seedPosting(context, {
        atsJobId: "open-gate-1",
        boardId,
        companyId,
        url: "https://open-gate.example/jobs/1",
      });

      const blocked = postingSchema.parse(
        await (await context.get(`/api/postings/${postingId}`)).json(),
      );

      expect(blocked.score).toBeNull();
      expect(anthropic.batchesCreated()).toBe(0);
      expect(llmUsageRows(publicServer)).toEqual([]);

      await context.post("/__test__/ledger/grant", {
        data: { email: EXISTING_EMAIL, idempotencyKey: "open-gate-trial", quantity: 3 },
      });

      const allowed = postingSchema.parse(
        await (await context.get(`/api/postings/${postingId}`)).json(),
      );

      expect(allowed.score).not.toBeNull();
      expect(anthropic.batchesCreated()).toBe(1);
      expect(llmUsageRows(publicServer)).toHaveLength(1);

      await context.dispose();
    },
  );

  publicTest(
    "the global LLM cap refuses the call and alerts the owner",
    async ({ anthropic, publicServer, publicUrl }) => {
      const { context } = await signInNewEmail(publicUrl, NEW_EMAIL);
      const owner = await apiRequest.newContext({ baseURL: publicUrl });

      await requestMagicLink(publicUrl, owner, authTestIdentity.ownerEmail);

      const ownerLink = await latestMailLink(publicUrl, owner, authTestIdentity.ownerEmail);

      await owner.get(ownerLink);

      const ownerState = await verifyAuthState(publicUrl, owner);
      const ownerUser = ownerState.users.find((user) => user.email === authTestIdentity.ownerEmail);

      await context.post("/__test__/ledger/grant", {
        data: { email: NEW_EMAIL, idempotencyKey: "cap-grant", quantity: 3 },
      });

      await context.post("/__test__/llm/usage", {
        data: {
          cachedTokens: 0,
          costMicros: 10_000_000,
          inputTokens: 0,
          model: "claude-test",
          outputTokens: 0,
          purpose: "score",
        },
      });

      const blocked = await uploadResume(context);

      expect(blocked.parsedWith).toBe("unpdf");
      expect(blocked.unreadable).toBe(true);
      expect(anthropic.singleMessages()).toEqual([]);
      expect(llmUsageRows(publicServer)).toHaveLength(1);

      const notifications = notificationsSchema.parse(
        await (
          await owner.get(
            `/__test__/notifications?userId=${encodeURIComponent(ownerUser?.id ?? "")}`,
          )
        ).json(),
      );

      expect(
        notifications.notifications.some((row) => row.title === "Overture alert: llm.cap"),
      ).toBe(true);

      await context.dispose();
      await owner.dispose();
    },
  );

  publicTest("the magic-link limit holds for public sign-up", async ({ request, publicUrl }) => {
    const magicEmail = "limited.magic@example.com";

    const asked = async (ip: string) =>
      request.post(`${publicUrl}/api/auth/sign-in/magic-link`, {
        data: { callbackURL: "/signin", email: magicEmail },
        headers: {
          "x-captcha-response": authTestIdentity.turnstilePassToken,
          "x-forwarded-for": ip,
          "x-turnstile-action": "magiclink",
          origin: publicUrl,
        },
      });

    const first = await asked("198.51.100.3");
    const second = await asked("198.51.100.3");
    const third = await asked("198.51.100.3");
    const fourth = await asked("198.51.100.3");

    expect([first.ok(), second.ok(), third.ok()]).toEqual([true, true, true]);
    expect(fourth.status()).toBe(429);

    const otherIp = await asked("198.51.100.4");

    expect(otherIp.ok()).toBe(true);
  });

  publicTest(
    "an existing account keeps its admin grant when public sign-up is on",
    async ({ request, publicUrl }) => {
      const created = await request.post(`${publicUrl}/__test__/users`, {
        data: { email: EXISTING_EMAIL, name: "Existing Beta User" },
      });

      expect(created.status()).toBe(200);

      const granted = await request.post(`${publicUrl}/__test__/ledger/grant`, {
        data: { email: EXISTING_EMAIL, idempotencyKey: "m2-grant", quantity: 300 },
      });

      expect(applicationsLeftSchema.parse(await granted.json()).applicationsLeft).toBe(300);

      const { context } = await signInNewEmail(publicUrl, EXISTING_EMAIL);
      const home = homeSchema.parse(await (await context.get("/api/home")).json());

      expect(home.applicationsLeft).toBe(300);
      expect(home.planApplications).toBe(300);

      await context.dispose();
    },
  );
});
