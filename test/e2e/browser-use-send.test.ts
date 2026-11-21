import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";
import type { BrowserUseFixture } from "./browser-use-server.fixture.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import {
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const questions = [
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
  outcome: z.string().nullable(),
  provider: z.string(),
  providerSessionId: z.string().nullable(),
  proxyBytes: z.number().nullable(),
  submitClickedAt: z.number().nullable(),
});

const attemptsSchema = z.object({ attempts: z.array(attemptSchema) });

interface SendHarness {
  fixture: BrowserUseFixture;
  greenhouse: GreenhouseFixture;
  server: AppServer;
}

async function startHarness(identityServer: IdentityServer, hardTimeoutMs = 30_000) {
  const directory = mkdtempSync(join(tmpdir(), "overture-browser-use-send-"));
  const fixture = startBrowserUseFixture();
  const greenhouse = startGreenhouseFixture();

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "browser_use",
    BROWSER_PROXY_COUNTRY: "ca",
    BROWSER_USE_API_BASE_URL: fixture.url,
    BROWSER_USE_API_KEY: "browser-use-send-test-key",
    OBJECT_STORE_ROOT: join(directory, "objects"),
    SEND_HARD_TIMEOUT_MS: String(hardTimeoutMs),
  });

  return { fixture, greenhouse, server };
}

async function closeHarness(harness: SendHarness) {
  await harness.server.stop();
  harness.fixture.close();
  harness.greenhouse.close();
}

async function readyApplication(harness: SendHarness, url: string) {
  const { owner, userId } = await ownerContextFor(harness.server.url);

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
    atsJobId: "8004209003",
    boardId,
    companyId,
    questions,
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

test("a send try that cannot find the form still stops its Browser Use session", async ({
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const { applicationId, owner } = await readyApplication(
      harness,
      `${harness.greenhouse.url}/blankstreet/jobs/not-a-form`,
    );

    await runSend(owner, applicationId);

    const [attempt] = await attemptsOf(owner, applicationId);

    if (attempt === undefined) {
      throw new Error("the failed send try left no attempt");
    }

    expect(attempt.outcome).toBe("form_changed");
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
