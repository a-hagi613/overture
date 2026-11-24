import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { WaveTwoBoardsFixture } from "./wave2-ats.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { WAVE_2_BOARD_NAMES, startWaveTwoBoardsFixture } from "./wave2-ats.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

type Board = (typeof WAVE_2_BOARD_NAMES)[number];

const JOB_ID: Record<Board, string> = { herp: "HP-1001", jobvite: "JV-1001" };
const TITLE = "Senior Platform Engineer";
const COMPANY = "Wave Two Corp";

const SPONSORSHIP_PROMPT =
  "Will you now, or in the future, require visa sponsorship to legally work in the country where this role is based?";

const SPONSORSHIP_NO =
  "No, I do not require sponsorship to work in the country where this role is located";

const PRIVACY_PROMPT = "Agree to the Privacy Policy";

interface WaveTwoHarness {
  fixture: WaveTwoBoardsFixture;
  server: AppServer;
}

const startHarness = async (identityServer: Parameters<typeof startFreshAppServer>[0]) => {
  const directory = mkdtempSync(join(tmpdir(), "overture-wave2-ats-"));
  const fixture = startWaveTwoBoardsFixture();

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "local",
    BROWSER_SESSION_DIR: join(directory, "browsers"),
  });

  return { fixture, server } satisfies WaveTwoHarness;
};

async function withHarness(
  identityServer: Parameters<typeof startFreshAppServer>[0],
  provide: (harness: WaveTwoHarness) => Promise<void>,
) {
  const harness = await startHarness(identityServer);

  try {
    await provide(harness);
  } finally {
    await harness.server.stop();
    harness.fixture.close();
  }
}

const test = appTest.extend<{ waveTwo: WaveTwoHarness }>({
  waveTwo: [
    async ({ identityServer }, provide) => withHarness(identityServer, provide),
    { scope: "test" },
  ],
});

test.describe.configure({ timeout: 120_000 });

const applicationRowSchema = z.object({
  approvedAt: z.number().nullable(),
  id: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
  stage: z.string().nullable(),
});

const attemptSchema = z.object({
  outcome: z.string().nullable(),
  submitClickedAt: z.number().nullable(),
  submitResponseStatus: z.number().nullable(),
});

const attemptsSchema = z.object({ attempts: z.array(attemptSchema) });

const snapshotSchema = z.object({
  answers: z.array(
    z.object({
      answer: z.string().nullable(),
      kind: z.string(),
      label: z.string(),
    }),
  ),
  confirmedBy: z.string(),
});

const applicationDetailSchema = z.object({
  application: applicationRowSchema,
  snapshot: snapshotSchema.nullable(),
});

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const baseFacts = [
  { key: "legal_name", value: "Maya Okafor", scope: "" },
  { key: "email", value: "maya.okafor@example.com", scope: "" },
  { key: "phone", value: "+44 20 7946 0018", scope: "" },
  { key: "current_city", value: "Toronto", scope: "" },
  { key: "current_country", value: "Canada", scope: "" },
  { key: "languages", value: "English", scope: "" },
  { key: "sponsorship_required", value: SPONSORSHIP_NO, scope: "" },
];

async function ownerFor(server: AppServer, board: Board) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });
  expect((await owner.post("/api/running", { data: { running: true } })).ok()).toBe(true);
  expect(
    (
      await owner.put(`/__test__/kill-switches/ats/${board}`, {
        data: { enabled: false, reason: "the fixture probe passed" },
      })
    ).ok(),
  ).toBe(true);

  const resume = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });

  expect(resume.ok()).toBe(true);

  const saved = await owner.put("/api/profile/facts", { data: { facts: baseFacts } });

  expect(saved.ok()).toBe(true);

  return { owner, userId };
}

function postingUrl(harness: WaveTwoHarness, board: Board, variant: "apply" | "gated") {
  const jobId = JOB_ID[board];

  if (board === "jobvite") {
    return variant === "gated"
      ? `${harness.fixture.url}/acme/job/${jobId}/gated`
      : `${harness.fixture.url}/acme/job/${jobId}`;
  }

  return variant === "gated"
    ? `${harness.fixture.url}/v1/acme/${jobId}/gated`
    : `${harness.fixture.url}/v1/acme/${jobId}`;
}

async function seededApplication(
  harness: WaveTwoHarness,
  board: Board,
  input: { closed?: boolean; gated?: boolean } = {},
) {
  const { owner, userId } = await ownerFor(harness.server, board);

  harness.fixture.state[board].closed = input.closed === true;

  const companyId = await seedCompany(owner, COMPANY, "wave-two.example");
  const boardId = await seedBoard(owner, companyId, board, "acme");

  const postingId = await seedPosting(owner, {
    ats: board,
    atsJobId: JOB_ID[board],
    boardId,
    companyId,
    title: TITLE,
    url: postingUrl(harness, board, input.gated === true ? "gated" : "apply"),
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));

  return { applicationId, boardId, owner, postingId, userId };
}

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", { data: { kind, payload } });

  expect(response.ok()).toBe(true);
}

async function approveForSend(owner: APIRequestContext, applicationId: string) {
  await grantApplications(owner, 3);
  await approveApplication(owner, applicationId);
}

async function runSend(owner: APIRequestContext, applicationId: string) {
  return owner.post("/__test__/jobs/run-now", {
    data: { kind: "application.send", payload: JSON.stringify({ applicationId }) },
    timeout: 120_000,
  });
}

async function applicationOf(owner: APIRequestContext, applicationId: string) {
  return applicationDetailSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
  );
}

async function attemptsOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return attemptsSchema.parse(await response.json()).attempts;
}

for (const board of WAVE_2_BOARD_NAMES) {
  test(`${board}: preparation waits for approval, then the approved plan sends the real answers`, async ({
    waveTwo,
  }) => {
    const { applicationId, owner } = await seededApplication(waveTwo, board);
    const prepared = await applicationOf(owner, applicationId);

    expect(prepared.application.status).toBe("ready");
    expect(waveTwo.fixture.state[board].submissions).toBe(0);
    expect(waveTwo.fixture.state[board].applicationRequests).toBe(0);

    await approveForSend(owner, applicationId);

    const response = await runSend(owner, applicationId);

    expect(response.ok()).toBe(true);

    const detail = await applicationOf(owner, applicationId);

    expect(detail.application.status).toBe("sent");
    expect(detail.application.stage).toBe("applied");
    expect(detail.snapshot?.confirmedBy).toBe("page");

    const answers = new Map(
      detail.snapshot?.answers.map((answer) => [answer.label, answer.answer]),
    );

    expect(answers.get("Phone")).toBe("+44 20 7946 0018");

    if (board === "jobvite") {
      expect(answers.get("Email Address")).toBe("maya.okafor@example.com");
      expect(answers.get("First Name")).toBe("Maya");
      expect(answers.get("Last Name")).toBe("Okafor");
      expect(answers.get("Country of residence")).toBe("Canada");
      expect(answers.get(SPONSORSHIP_PROMPT)).toBe("No");
      expect(answers.get("Which languages do you speak?")).toBe("English");
      expect(answers.get("City")).toBe("Toronto");
    } else {
      expect(answers.get("Email")).toBe("maya.okafor@example.com");
      expect(answers.get(PRIVACY_PROMPT)).toBe("Yes");
    }

    const state = waveTwo.fixture.state[board];

    expect(state.applicationRequests).toBe(1);
    expect(state.submissions).toBe(1);
    expect(Buffer.from(state.lastResumeBytes ?? new Uint8Array()).toString("base64")).toBe(
      Buffer.from(resumeBytes).toString("base64"),
    );

    if (board === "jobvite") {
      expect(state.consentLoads).toBeGreaterThan(0);
      expect(state.lastForm["input-fn"]).toBe("Maya");
      expect(state.lastForm["input-ln"]).toBe("Okafor");
      expect(state.lastForm["input-em"]).toBe("maya.okafor@example.com");
      expect(state.lastForm["input-co"]).toBe("Canada");
      expect(state.lastForm["f0"]).toBe("No");
      expect(state.lastForm["input-f2"]).toBe("Toronto");
    } else {
      expect(state.lastForm["name"]).toBe("Maya Okafor");
      expect(state.lastForm["email"]).toBe("maya.okafor@example.com");
      expect(state.lastForm["privacyPolicy"]).toBe("true");
    }

    const attempts = await attemptsOf(owner, applicationId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("sent");
    expect(attempts[0]?.submitClickedAt).not.toBeNull();
    expect(attempts[0]?.submitResponseStatus).toBe(201);
  });

  test(`${board}: a mandatory login gate skips preparation as unsupported_login_required before any spend`, async ({
    waveTwo,
  }) => {
    const { applicationId, owner } = await seededApplication(waveTwo, board, { gated: true });
    const detail = await applicationOf(owner, applicationId);

    expect(detail.application.status).toBe("skipped");
    expect(detail.application.statusReason).toBe("unsupported_login_required");
    expect(detail.snapshot).toBeNull();
    expect(waveTwo.fixture.state[board].submissions).toBe(0);
  });
}

test("herp: a closed posting is refused at the adapter before anything is submitted", async ({
  waveTwo,
}) => {
  const { applicationId, owner } = await seededApplication(waveTwo, "herp", { closed: true });

  expect((await applicationOf(owner, applicationId)).application.status).toBe("ready");

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("blocked");
  expect(attempts[0]?.submitClickedAt).toBeNull();
  expect(waveTwo.fixture.state.herp.submissions).toBe(0);
  expect(waveTwo.fixture.state.herp.applicationRequests).toBe(0);
});
