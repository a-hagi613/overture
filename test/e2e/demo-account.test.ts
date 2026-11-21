import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { subscriptionKeys, vapidKeyPair } from "./push.fixture.ts";
import { sinkMailCount } from "./sign-in.ts";

const demoEmail = "test@email.com";

const homeSchema = z.object({
  activity: z.object({ sent: z.array(z.unknown()) }),
  checkInDue: z.number(),
  ranges: z.record(z.string(), z.object({ applicationsSent: z.number() })),
  ready: z.object({ approved: z.number(), ready: z.number() }),
  reviews: z.object({ total: z.number() }),
});

const readySchema = z.object({
  approved: z.number(),
  cards: z.array(
    z.object({
      company: z.string(),
      id: z.string(),
      plan: z.object({ answers: z.array(z.unknown()) }).nullable(),
      status: z.enum(["ready", "approved"]),
    }),
  ),
  ready: z.number(),
});

const boardSchema = z.object({
  columns: z.array(z.object({ cards: z.array(z.unknown()), stage: z.string() })),
  total: z.number(),
});

const reviewsSchema = z.object({
  reviews: z.array(z.object({ id: z.string(), unlocked: z.number() })),
});

const factsSchema = z.object({ facts: z.array(z.object({ key: z.string() })) });

const authStateSchema = z.object({
  sessions: z.array(z.object({ expiresAt: z.string(), userId: z.string() })),
  users: z.array(z.object({ email: z.string(), id: z.string(), role: z.string() })),
});

const mailboxesSchema = z.object({ mailboxes: z.array(z.object({ id: z.string() })) });
const threadsSchema = z.object({ threads: z.array(z.object({ id: z.string() })) });

const applicationsSchema = z.object({
  applications: z.array(
    z.object({ id: z.string(), scheduledFor: z.number().nullable(), status: z.string() }),
  ),
});

const attemptsSchema = z.object({ attempts: z.array(z.unknown()) });

const jobsSchema = z.object({
  jobs: z.array(z.object({ id: z.string(), kind: z.string(), status: z.string() })),
});

const requestsSchema = z.object({ requests: z.array(z.unknown()) });

const clockSchema = z.object({ now: z.number() });

const notificationsSchema = z.object({
  notifications: z.array(z.object({ id: z.string(), title: z.string() })),
});

const test = appTest.extend<{ demoServer: AppServer; noDemoServer: AppServer }>({
  demoServer: [
    async ({ identityServer }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-demo-"));
      const anthropic = await startAnthropicFixtureServer();
      const vapid = vapidKeyPair();

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: join(directory, "browsers"),
        DEMO_LOGIN_ENABLED: "true",
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_PUBLIC_KEY: vapid.publicKey,
      });

      await provide(server);
      await server.stop();
      anthropic.stop();
    },
    { scope: "test" },
  ],
  noDemoServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

function demoSignInHeaders(url: string) {
  return {
    "x-captcha-response": authTestIdentity.turnstilePassToken,
    "x-turnstile-action": "magiclink",
    origin: url,
  };
}

async function signInDemo(request: APIRequestContext, url: string) {
  const response = await request.post(`${url}/api/auth/demo/sign-in`, {
    data: { email: demoEmail },
    headers: demoSignInHeaders(url),
  });

  expect(response.ok()).toBe(true);
}

async function demoUser(request: APIRequestContext, url: string) {
  const state = authStateSchema.parse(
    await (await request.get(`${url}/__test__/auth/state`)).json(),
  );

  const user = state.users.find((candidate) => candidate.email === demoEmail);

  expect(user?.role).toBe("demo");

  return { state, user };
}

test("test@email.com signs in with one click and every main screen is populated", async ({
  browser,
  demoServer,
}) => {
  const page = await browser.newPage();

  await page.goto(`${demoServer.url}/signin`);
  await page.getByLabel("Email").fill(demoEmail);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();

  const { request } = page;
  const { state, user } = await demoUser(request, demoServer.url);
  const session = state.sessions.find((candidate) => candidate.userId === user?.id);

  expect(session).toBeDefined();

  const clock = clockSchema.parse(
    await (await request.get(`${demoServer.url}/__test__/clock`)).json(),
  );

  const remainingHours =
    (new Date(session?.expiresAt ?? 0).getTime() - clock.now) / (60 * 60 * 1000);

  expect(remainingHours).toBeGreaterThan(23);
  expect(remainingHours).toBeLessThan(25);

  const home = homeSchema.parse(await (await request.get(`${demoServer.url}/api/home`)).json());

  const ready = readySchema.parse(await (await request.get(`${demoServer.url}/api/ready`)).json());

  const board = boardSchema.parse(await (await request.get(`${demoServer.url}/api/board`)).json());

  const reviews = reviewsSchema.parse(
    await (await request.get(`${demoServer.url}/api/reviews`)).json(),
  );

  const facts = factsSchema.parse(
    await (await request.get(`${demoServer.url}/api/profile/facts`)).json(),
  );

  expect(ready.ready).toBeGreaterThanOrEqual(2);
  expect(ready.approved).toBeGreaterThanOrEqual(1);
  expect(ready.cards.some((card) => card.plan !== null && card.plan.answers.length > 0)).toBe(true);

  expect(board.total).toBeGreaterThanOrEqual(15);

  for (const column of board.columns) {
    expect(column.cards.length, `the ${column.stage} column is empty`).toBeGreaterThan(0);
  }

  expect(reviews.reviews.length).toBeGreaterThanOrEqual(2);
  expect(home.reviews.total).toBeGreaterThanOrEqual(2);
  expect(home.ready.ready).toBeGreaterThanOrEqual(2);
  expect(home.checkInDue).toBeGreaterThanOrEqual(1);
  expect(home.activity.sent.length).toBeGreaterThanOrEqual(1);
  expect(home.ranges["90D"]?.applicationsSent).toBeGreaterThanOrEqual(10);
  expect(facts.facts.length).toBeGreaterThanOrEqual(10);

  const mailboxes = mailboxesSchema.parse(
    await (
      await request.get(
        `${demoServer.url}/__test__/mailboxes?userId=${encodeURIComponent(user?.id ?? "")}`,
      )
    ).json(),
  );

  const threads = threadsSchema.parse(
    await (
      await request.get(
        `${demoServer.url}/__test__/mail/threads?mailboxId=${encodeURIComponent(mailboxes.mailboxes[0]?.id ?? "")}`,
      )
    ).json(),
  );

  expect(threads.threads.length).toBeGreaterThanOrEqual(6);

  await expect(page.getByText("Lumen Orchard").first()).toBeVisible();

  await page.goto(`${demoServer.url}/ready`);
  await expect(page.getByRole("heading", { name: "Ready to send" })).toBeVisible();
  await expect(page.getByText("Paper Kite").first()).toBeVisible();

  await page.goto(`${demoServer.url}/board`);
  await expect(page.getByRole("heading", { name: "Your Board" })).toBeVisible();
  await expect(page.getByText("Tidepool Analytics").first()).toBeVisible();

  await page.goto(`${demoServer.url}/review`);
  await expect(page.getByRole("heading", { name: "Your Review" })).toBeVisible();
  await expect(
    page.getByText("What are your salary expectations for this role?").first(),
  ).toBeVisible();

  await page.goto(`${demoServer.url}/inbox`);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

  await page.goto(`${demoServer.url}/profile`);
  await expect(page.getByRole("heading", { name: "Your Profile" })).toBeVisible();

  await page.close();
});

test("the demo path is refused when it is switched off", async ({ noDemoServer, page }) => {
  await page.goto(`${noDemoServer.url}/signin`);
  await page.getByLabel("Email").fill(demoEmail);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  await expect(page.getByText("Invitation only for now.")).toBeVisible();

  const request = await apiRequest.newContext({ baseURL: noDemoServer.url });

  const response = await request.post(`${noDemoServer.url}/api/auth/demo/sign-in`, {
    data: { email: demoEmail },
    headers: demoSignInHeaders(noDemoServer.url),
  });

  expect(response.status()).toBe(404);

  await request.dispose();
});

test("the demo path still needs Turnstile", async ({ demoServer }) => {
  const request = await apiRequest.newContext({ baseURL: demoServer.url });

  const response = await request.post(`${demoServer.url}/api/auth/demo/sign-in`, {
    data: { email: demoEmail },
  });

  expect(response.status()).toBe(403);
  expect(await response.text()).toContain("captcha_failed");

  await request.dispose();
});

const lockedSchema = z.object({
  code: z.literal("demo_locked").optional(),
  error: z.literal("demo_locked").optional(),
  message: z.string().min(1),
});

test("a production start logs that the demo login is on and the demo is send-safe", async ({
  demoServer,
}) => {
  const line = await demoServer.waitForStderr(/overture demo: login enabled for test@email\.com/u);

  expect(line).toContain("login enabled for test@email.com");
  expect(line).toContain("blocked");
});

test("the demo is refused on uploads, preparation and every write with a friendly 403", async ({
  demoServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: demoServer.url });

  await signInDemo(request, demoServer.url);

  const routes: { data?: unknown; method: "GET" | "POST" | "PUT"; path: string }[] = [
    { method: "POST", path: "/api/profile/resume" },
    { method: "GET", path: "/api/profile/resume/demo-resume-0001/file" },
    { method: "GET", path: "/api/postings/demo-posting-01" },
    { data: { value: "Yes" }, method: "POST", path: "/api/reviews/demo-review-01/answer" },
    { data: { jobTitle: "Engineer" }, method: "PUT", path: "/api/onboarding/facts" },
    { method: "POST", path: "/api/postings/demo-posting-01/apply" },
    {
      data: { value: "Sam Rivera" },
      method: "PUT",
      path: "/api/applications/demo-app-01/answers/demo-q-legal_name",
    },
    { data: {}, method: "POST", path: "/api/auth/delete-user" },
    { data: {}, method: "POST", path: "/api/auth/revoke-other-sessions" },
    { data: {}, method: "POST", path: "/api/auth/change-email" },
    { data: { running: false }, method: "POST", path: "/api/running" },
    { method: "POST", path: "/api/notifications/read-all" },
    { data: {}, method: "POST", path: "/api/push/subscribe" },
    { data: {}, method: "PUT", path: "/api/profile/targets" },
  ];

  const responses = await Promise.all(
    routes.map(async (route) => {
      const headers = demoSignInHeaders(demoServer.url);

      const response =
        route.data === undefined
          ? await request.fetch(`${demoServer.url}${route.path}`, { headers, method: route.method })
          : await request.fetch(`${demoServer.url}${route.path}`, {
              data: route.data,
              headers,
              method: route.method,
            });

      const body: unknown = await response.json();

      return { body, path: route.path, status: response.status() };
    }),
  );

  for (const response of responses) {
    expect(response.status, response.path).toBe(403);

    const locked = lockedSchema.safeParse(response.body);

    expect(
      locked.success,
      `${response.path} (${String(response.status)}): ${JSON.stringify(response.body)}`,
    ).toBe(true);

    if (locked.success) {
      expect(locked.data.code ?? locked.data.error, response.path).toBe("demo_locked");
      expect(locked.data.message, response.path).toContain("view-only");
    }
  }

  await request.dispose();
});

test("two visitors keep their demo sessions at the same time", async ({ demoServer }) => {
  const first = await apiRequest.newContext({ baseURL: demoServer.url });
  const second = await apiRequest.newContext({ baseURL: demoServer.url });

  await signInDemo(first, demoServer.url);
  await signInDemo(second, demoServer.url);

  const pages = await Promise.all([
    first.get(`${demoServer.url}/api/home`),
    second.get(`${demoServer.url}/api/home`),
  ]);

  for (const page of pages) {
    expect(page.status()).toBe(200);
  }

  const { user } = await demoUser(first, demoServer.url);

  const state = authStateSchema.parse(
    await (await first.get(`${demoServer.url}/__test__/auth/state`)).json(),
  );

  expect(state.sessions.filter((session) => session.userId === user?.id)).toHaveLength(2);

  await first.dispose();
  await second.dispose();
});

test("the demo never sends, queues a send job or reaches a service", async ({ demoServer }) => {
  const request = await apiRequest.newContext({ baseURL: demoServer.url });

  const response = await request.post(`${demoServer.url}/api/auth/demo/sign-in`, {
    data: { email: demoEmail },
    headers: demoSignInHeaders(demoServer.url),
  });

  expect(response.ok()).toBe(true);

  const { user } = await demoUser(request, demoServer.url);
  const userId = user?.id ?? "";

  const clock = clockSchema.parse(
    await (await request.get(`${demoServer.url}/__test__/clock`)).json(),
  );

  const before = applicationsSchema.parse(
    await (await request.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)).json(),
  );

  const approved = before.applications.find((application) => application.status === "approved");

  expect(approved).toBeDefined();

  await request.post(`${demoServer.url}/__test__/clock/offset`, {
    data: { offsetMs: 2 * 24 * 60 * 60 * 1000 },
  });

  const kinds = [
    { kind: "dispatch.tick", payload: "{}" },
    { kind: "prep.daily", payload: JSON.stringify({ since: 0, userId }) },
    { kind: "checkin.sweep", payload: "{}" },
    { kind: "ready.notify", payload: JSON.stringify({ since: 0, userId }) },
    { kind: "planner.day", payload: JSON.stringify({ userId }) },
  ];

  await Promise.all(
    kinds.map(async (job) => {
      const ran = await request.post(`${demoServer.url}/__test__/jobs/run-now`, { data: job });

      expect(ran.ok(), `${job.kind} did not run`).toBe(true);
    }),
  );

  const after = applicationsSchema.parse(
    await (await request.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)).json(),
  );

  expect(after.applications).toHaveLength(before.applications.length);

  const approvedAfter = after.applications.find((application) => application.id === approved?.id);

  expect(approvedAfter?.status).toBe("approved");
  expect(approvedAfter?.scheduledFor).toBe(approved?.scheduledFor);

  const attempts = await Promise.all(
    after.applications.map(async (application) => ({
      application,
      rows: attemptsSchema.parse(
        await (
          await request.get(
            `/__test__/attempts?applicationId=${encodeURIComponent(application.id)}`,
          )
        ).json(),
      ).attempts,
    })),
  );

  for (const row of attempts) {
    expect(row.rows, `${row.application.id} was attempted`).toHaveLength(0);
  }

  const jobs = jobsSchema.parse(await (await request.get("/__test__/jobs")).json());

  expect(jobs.jobs.some((job) => job.kind === "application.send")).toBe(false);

  const keys = subscriptionKeys();

  const subscribed = await request.post(`${demoServer.url}/__test__/push/subscriptions`, {
    data: { endpoint: "https://push.example.test/send/demo", keys, userId },
  });

  expect(subscribed.ok()).toBe(true);

  await request.post(`${demoServer.url}/__test__/notifications/seed`, {
    data: {
      email: demoEmail,
      rows: [
        {
          at: clock.now,
          body: "A reply arrived for the demo account.",
          kind: "reply",
          title: "Demo push",
          url: "/",
        },
      ],
    },
  });

  const notifications = notificationsSchema.parse(
    await (
      await request.get(
        `${demoServer.url}/__test__/notifications?userId=${encodeURIComponent(userId)}`,
      )
    ).json(),
  );

  const demoPush = notifications.notifications.find(
    (notification) => notification.title === "Demo push",
  );

  expect(demoPush).toBeDefined();

  const pushed = await request.post(`${demoServer.url}/__test__/jobs/run-now`, {
    data: { kind: "push.notify", payload: JSON.stringify({ notificationId: demoPush?.id ?? "" }) },
  });

  expect(pushed.ok()).toBe(true);

  const mail = requestsSchema.parse(await (await request.get("/__test__/cloudflare-email")).json());
  const pushes = requestsSchema.parse(await (await request.get("/__test__/push/requests")).json());

  expect(mail.requests).toHaveLength(0);
  expect(pushes.requests).toHaveLength(0);
  expect(await sinkMailCount(demoServer.url, request)).toBe(0);

  await request.dispose();
});
