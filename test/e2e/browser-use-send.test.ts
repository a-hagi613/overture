import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";
import type { BrowserUseFixture, BrowserUseFixtureOptions } from "./browser-use-server.fixture.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

interface SeedQuestion {
  answerKind: "fact" | "open_text" | "consent" | "skip" | "target" | "derived" | "unknown";
  fieldName: string;
  fieldType:
    | "text"
    | "textarea"
    | "select"
    | "multiselect"
    | "radio"
    | "checkbox"
    | "file"
    | "date"
    | "number"
    | "email"
    | "phone"
    | "url";
  required: boolean;
  text: string;
  factKey?: string;
  options?: string[];
}

const questions: readonly SeedQuestion[] = [
  {
    answerKind: "fact" as const,
    factKey: "legal_name",
    fieldName: "first_name",
    fieldType: "text" as const,
    required: true,
    text: "First Name",
  },
  {
    answerKind: "fact" as const,
    factKey: "legal_name",
    fieldName: "last_name",
    fieldType: "text" as const,
    required: true,
    text: "Last Name",
  },
  {
    answerKind: "fact" as const,
    factKey: "email",
    fieldName: "email",
    fieldType: "email" as const,
    required: true,
    text: "Email",
  },
  {
    answerKind: "fact" as const,
    factKey: "phone",
    fieldName: "phone",
    fieldType: "phone" as const,
    required: false,
    text: "Phone",
  },
  {
    answerKind: "fact" as const,
    factKey: "current_country",
    fieldName: "country",
    fieldType: "select" as const,
    options: ["Canada", "United Kingdom", "United States"],
    required: false,
    text: "Country",
  },
  {
    answerKind: "fact" as const,
    factKey: "linkedin_url",
    fieldName: "question_32895467003",
    fieldType: "url" as const,
    required: false,
    text: "LinkedIn Profile",
  },
  {
    answerKind: "open_text" as const,
    fieldName: "question_32895468003",
    fieldType: "text" as const,
    required: false,
    text: "Website",
  },
  {
    answerKind: "skip" as const,
    fieldName: "resume",
    fieldType: "file" as const,
    required: true,
    text: "Resume/CV",
  },
];

const facts = [
  { key: "legal_name", value: "Maya Okafor" },
  { key: "email", value: "maya.okafor@example.com" },
  { key: "phone", value: "+1 416 555 0199" },
  { key: "current_country", value: "United Kingdom" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor" },
];

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const attemptSchema = z.object({
  browserMs: z.number().nullable(),
  costMicros: z.number().nullable(),
  endedAt: z.number().nullable(),
  id: z.string(),
  outcome: z.string().nullable(),
  provider: z.string(),
  providerSessionId: z.string().nullable(),
  proxyBytes: z.number().nullable(),
  submitClickedAt: z.number().nullable(),
});

const attemptsSchema = z.object({ attempts: z.array(attemptSchema) });

const reviewSchema = z.object({
  attemptId: z.string().nullable(),
  id: z.string(),
  prompt: z.string(),
  status: z.string(),
});

const reviewsSchema = z.object({ reviews: z.array(reviewSchema) });

interface SendHarness {
  fixture: BrowserUseFixture;
  greenhouse: GreenhouseFixture;
  server: AppServer;
}

interface SendHarnessOptions {
  fixture?: BrowserUseFixtureOptions;
  usageSettleMs?: number;
}

async function startHarness(
  identityServer: IdentityServer,
  hardTimeoutMs = 30_000,
  options: SendHarnessOptions = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "overture-browser-use-send-"));
  const fixture = startBrowserUseFixture(options.fixture);
  const greenhouse = startGreenhouseFixture();

  const environment = {
    BROWSER_PROVIDER: "browser_use",
    BROWSER_PROXY_COUNTRY: "ca",
    BROWSER_USE_API_BASE_URL: fixture.url,
    BROWSER_USE_API_KEY: "browser-use-send-test-key",
    BROWSER_USE_USAGE_SETTLE_MS: String(options.usageSettleMs ?? 30_000),
    GREENHOUSE_BOARD_BASE_URL: greenhouse.url,
    OBJECT_STORE_ROOT: join(directory, "objects"),
    SEND_HARD_TIMEOUT_MS: String(hardTimeoutMs),
  } satisfies Record<string, string>;

  const server = await startFreshAppServer(identityServer, environment);

  return { fixture, greenhouse, server };
}

async function closeHarness(harness: SendHarness) {
  await harness.server.stop();
  harness.fixture.close();
  harness.greenhouse.close();
}

async function readyApplication(
  harness: SendHarness,
  url: string,
  atsJobId = "8004209003",
  extraQuestions: readonly SeedQuestion[] = [],
) {
  const { owner, userId } = await ownerContextFor(harness.server.url);

  const running = await owner.post("/api/running", { data: { running: true } });

  expect(running.ok()).toBe(true);

  await owner.put("/api/profile/facts", { data: { facts } });

  const upload = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });

  expect(upload.ok()).toBe(true);

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");

  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const postingId = await seedPosting(owner, {
    atsJobId,
    boardId,
    companyId,
    questions: [...questions, ...extraQuestions],
    tags: [{ dimension: "subrole", value: "Operations" }],
    title: "Assistant General Manager | Durham",
    url,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  await grantApplications(owner, 3);
  await approveApplication(owner, applicationId);

  return { applicationId, owner, userId };
}

async function runSend(owner: APIRequestContext, applicationId: string) {
  return owner.post("/__test__/jobs/run-now", {
    data: { applicationId, kind: "application.send", payload: JSON.stringify({ applicationId }) },
  });
}

async function attemptsOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return attemptsSchema.parse(await response.json()).attempts;
}

async function reviewsOf(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/reviews?userId=${encodeURIComponent(userId)}`);

  return reviewsSchema.parse(await response.json()).reviews;
}

async function statusOf(owner: APIRequestContext, applicationId: string) {
  return z
    .object({ application: z.object({ status: z.string() }) })
    .parse(await (await owner.get(`/api/applications/${applicationId}`)).json()).application.status;
}

const killSwitchesSchema = z.array(
  z.object({
    enabled: z.number(),
    key: z.string(),
    reason: z.string(),
    scope: z.string(),
  }),
);

const notificationsSchema = z.object({
  notifications: z.array(z.object({ body: z.string(), kind: z.string(), title: z.string() })),
});

async function runRecover(owner: APIRequestContext) {
  return owner.post("/__test__/jobs/run-now", {
    data: { kind: "dispatch.recover", payload: "{}" },
  });
}

async function mutateForm(harness: SendHarness, mutation: string) {
  const response = await fetch(`${harness.greenhouse.url}/__fixture__/mutate`, {
    body: JSON.stringify({ mutation }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(response.ok).toBe(true);
}

test("a send try through Browser Use records its usage and stops the vendor browser", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    const response = await runSend(owner, applicationId);

    expect(response.ok()).toBe(true);

    const detail = z
      .object({ application: z.object({ status: z.string() }), snapshot: z.unknown().nullable() })
      .parse(await (await owner.get(`/api/applications/${applicationId}`)).json());

    expect(detail.application.status).toBe("sent");
    expect(detail.snapshot).not.toBeNull();

    const [attempt] = await attemptsOf(owner, applicationId);

    if (attempt === undefined) {
      throw new Error("the send try left no attempt");
    }

    expect(attempt.provider).toBe("browser_use");
    expect(attempt.providerSessionId).not.toBeNull();
    expect(attempt.outcome).toBe("sent");
    expect(attempt.browserMs).toBe(556_000);
    expect(attempt.proxyBytes).toBe(2_710_000);
    expect(attempt.costMicros).toBe(28_800);
    expect(harness.fixture.stoppedSessionIds).toContain(attempt.providerSessionId);
    expect(harness.fixture.stoppedAttemptIds.length).toBeGreaterThan(0);
    expect(harness.greenhouse.state.submissions).toBe(1);
  } finally {
    await closeHarness(harness);
  }
});

test("a send try whose stop answers 404 still records the session's usage", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer, 30_000, { fixture: { failStops: true } });

  try {
    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    await runSend(owner, applicationId);

    expect(await statusOf(owner, applicationId)).toBe("sent");

    const [attempt] = await attemptsOf(owner, applicationId);

    if (attempt === undefined) {
      throw new Error("the send try left no attempt");
    }

    expect(attempt.outcome).toBe("sent");
    expect(attempt.browserMs).toBe(556_000);
    expect(attempt.proxyBytes).toBe(2_710_000);
    expect(attempt.costMicros).toBe(28_800);
    expect(harness.fixture.stoppedSessionIds).toEqual([]);
    expect(harness.greenhouse.state.submissions).toBe(1);
  } finally {
    await closeHarness(harness);
  }
});

test("the recovery sweep backfills usage that had not settled when the send try ended", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer, 30_000, {
    fixture: { holdUsage: true },
    usageSettleMs: 200,
  });

  try {
    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    await runSend(owner, applicationId);

    expect(await statusOf(owner, applicationId)).toBe("sent");

    const [unsettled] = await attemptsOf(owner, applicationId);

    if (unsettled === undefined) {
      throw new Error("the send try left no attempt");
    }

    expect(unsettled.outcome).toBe("sent");
    expect(unsettled.proxyBytes).toBe(0);
    expect(unsettled.costMicros).toBe(0);

    harness.fixture.settleUsage();

    expect((await runRecover(owner)).ok()).toBe(true);

    const [backfilled] = await attemptsOf(owner, applicationId);

    expect(backfilled?.browserMs).toBe(556_000);
    expect(backfilled?.proxyBytes).toBe(2_710_000);
    expect(backfilled?.costMicros).toBe(28_800);
  } finally {
    await closeHarness(harness);
  }
});

test("a 402 from Browser Use pauses dispatch, alerts the owner and is never retried", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer, 30_000, { fixture: { createStatus: 402 } });

  try {
    const { applicationId, owner, userId } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    await runSend(owner, applicationId);

    expect(await statusOf(owner, applicationId)).toBe("approved");

    const [attempt] = await attemptsOf(owner, applicationId);

    expect(attempt?.outcome).toBe("provider_error");
    expect(attempt?.submitClickedAt).toBeNull();
    expect(harness.fixture.sessions).toHaveLength(0);

    const switches = killSwitchesSchema.parse(
      await (await owner.get("/__test__/kill-switches")).json(),
    );

    expect(switches).toContainEqual(
      expect.objectContaining({ enabled: 1, key: "browser_use", scope: "provider" }),
    );

    const { notifications } = notificationsSchema.parse(
      await (
        await owner.get(`/__test__/notifications?userId=${encodeURIComponent(userId)}`)
      ).json(),
    );

    expect(notifications).toContainEqual(
      expect.objectContaining({ kind: "alert", title: "Overture alert: dispatch.kill_switch" }),
    );

    await runSend(owner, applicationId);

    expect(harness.fixture.sessions).toHaveLength(0);
    expect(harness.greenhouse.state.submissions).toBe(0);
  } finally {
    await closeHarness(harness);
  }
});

test("an unexpected required Fact stops before Submit and opens a Review for the attempt", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const { applicationId, owner, userId } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    await mutateForm(harness, "work-auth");
    await runSend(owner, applicationId);

    expect(await statusOf(owner, applicationId)).toBe("needs_review");

    const [attempt] = await attemptsOf(owner, applicationId);

    if (attempt === undefined) {
      throw new Error("the blocked send try left no attempt");
    }

    expect(attempt.outcome).toBe("needs_review");
    expect(attempt.submitClickedAt).toBeNull();
    expect(harness.greenhouse.state.submissions).toBe(0);

    const review = (await reviewsOf(owner, userId)).find((row) =>
      row.prompt.includes("authorized to work in Canada"),
    );

    expect(review).toMatchObject({ attemptId: attempt.id, status: "open" });
  } finally {
    await closeHarness(harness);
  }
});

test("a one-off field added to the live form ends form_changed and submits nothing", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const { applicationId, owner, userId } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    await mutateForm(harness, "one-off");
    await runSend(owner, applicationId);

    expect(await statusOf(owner, applicationId)).toBe("ready");

    const detail = z
      .object({ application: z.object({ changes: z.string().nullable() }) })
      .parse(await (await owner.get(`/api/applications/${applicationId}`)).json());

    expect(JSON.parse(detail.application.changes ?? "[]")).toEqual(["A new required question"]);

    const [attempt] = await attemptsOf(owner, applicationId);

    expect(attempt?.outcome).toBe("form_changed");
    expect(attempt?.submitClickedAt).toBeNull();
    expect(harness.greenhouse.state.submissions).toBe(0);
    expect(await reviewsOf(owner, userId)).toHaveLength(0);
  } finally {
    await closeHarness(harness);
  }
});

test("a field removed from the live form ends form_changed and submits nothing", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    await mutateForm(harness, "field-removed");
    await runSend(owner, applicationId);

    const [attempt] = await attemptsOf(owner, applicationId);

    expect(attempt?.outcome).toBe("form_changed");
    expect(attempt?.submitClickedAt).toBeNull();
    expect(harness.greenhouse.state.submissions).toBe(0);
  } finally {
    await closeHarness(harness);
  }
});

test("an option changed on the live form ends form_changed and submits nothing", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    await mutateForm(harness, "option-changed");
    await runSend(owner, applicationId);

    const [attempt] = await attemptsOf(owner, applicationId);

    expect(attempt?.outcome).toBe("form_changed");
    expect(attempt?.submitClickedAt).toBeNull();
    expect(harness.greenhouse.state.submissions).toBe(0);
  } finally {
    await closeHarness(harness);
  }
});

test("a planned consent checkbox is checked before Submit", async ({ identityServer }) => {
  const harness = await startHarness(identityServer);

  try {
    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
      "8004209003",
      [
        {
          answerKind: "consent",
          fieldName: "consent",
          fieldType: "checkbox",
          required: true,
          text: "I acknowledge the privacy notice",
        },
      ],
    );

    await mutateForm(harness, "consent");
    await runSend(owner, applicationId);

    expect(await statusOf(owner, applicationId)).toBe("sent");
    expect(harness.greenhouse.state.submissions).toBe(1);
  } finally {
    await closeHarness(harness);
  }
});

test("a send try that cannot find the form still stops its Browser Use session", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/not-a-form`,
      "not-a-form",
    );

    await runSend(owner, applicationId);

    const [attempt] = await attemptsOf(owner, applicationId);

    if (attempt === undefined) {
      throw new Error("the failed send try left no attempt");
    }

    expect(attempt.outcome).not.toBe("sent");
    expect(attempt.providerSessionId).not.toBeNull();
    expect(harness.fixture.stoppedSessionIds).toContain(attempt.providerSessionId);
    expect(harness.greenhouse.state.submissions).toBe(0);
  } finally {
    await closeHarness(harness);
  }
});

test("a send try that runs past the hard timeout stops its Browser Use session", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer, 250);

  try {
    await fetch(`${harness.greenhouse.url}/__fixture__/hold`, {
      body: JSON.stringify({ form: true }),
      method: "POST",
    });

    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/8004209003`,
    );

    await runSend(owner, applicationId);

    const [attempt] = await attemptsOf(owner, applicationId);

    if (attempt === undefined) {
      throw new Error("the timed-out send try left no attempt");
    }

    expect(attempt.outcome).toBe("timeout");
    expect(attempt.submitClickedAt).toBeNull();
    expect(attempt.providerSessionId).not.toBeNull();
    expect(harness.fixture.stoppedSessionIds).toContain(attempt.providerSessionId);
    expect(harness.greenhouse.state.submissions).toBe(0);
  } finally {
    await closeHarness(harness);
  }
});

test("the recovery sweep stops a Browser Use session whose try is unknown", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const { owner } = await ownerContextFor(harness.server.url);

    const orphan = await fetch(`${harness.fixture.url}/api/v4/browsers`, {
      body: JSON.stringify({
        metadata: { attemptId: "attempt-that-never-existed" },
        proxyCountryCode: "ca",
        solveCaptchas: true,
        timeout: 15,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).then(async (response) => z.object({ id: z.string() }).parse(await response.json()));

    const recovered = await owner.post("/__test__/jobs/run-now", {
      data: { kind: "dispatch.recover", payload: "{}" },
    });

    expect(recovered.ok()).toBe(true);
    expect(harness.fixture.stoppedSessionIds).toContain(orphan.id);
  } finally {
    await closeHarness(harness);
  }
});
