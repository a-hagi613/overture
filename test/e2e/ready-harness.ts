import { readFileSync } from "node:fs";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { zonedTimeToEpoch } from "../../src/server/platform/local-time.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const TIME_ZONE = "America/Toronto";

const referenceNow = zonedTimeToEpoch({ day: 21, month: 11, year: 2026 }, 12, 0, TIME_ZONE);
const sendAt = referenceNow + 2 * 60 * 60_000 + 20 * 60_000;

const createdSchema = z.object({ id: z.string() });

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const onCall = "Yes. I have been on a weekly rotation before and I am happy to keep one.";

interface QuestionSeed {
  text: string;
  fieldType: "text" | "textarea" | "email";
  required: boolean;
  factKey?: string;
  answerKind: "fact" | "open_text";
}

const questions: QuestionSeed[] = [
  {
    factKey: "legal_name",
    answerKind: "fact",
    fieldType: "text",
    required: true,
    text: "Full name",
  },
  {
    answerKind: "fact",
    factKey: "work_auth",
    fieldType: "text",
    required: true,
    text: "Are you legally able to work in the UK?",
  },
  {
    answerKind: "open_text",
    fieldType: "textarea",
    required: true,
    text: "Are you comfortable with a weekly on-call rotation?",
  },
  {
    answerKind: "fact",
    factKey: "years_total",
    fieldType: "text",
    required: true,
    text: "Years of Kubernetes experience",
  },
  {
    answerKind: "fact",
    factKey: "notice_period",
    fieldType: "text",
    required: true,
    text: "Notice period",
  },
  {
    answerKind: "open_text",
    fieldType: "textarea",
    required: true,
    text: "Cover letter",
  },
];

interface CardSeed {
  company: string;
  title: string;
  location: string;
  score: number;
  approved: boolean;
  omitNotice?: boolean;
  savedOnly?: boolean;
}

const cards: CardSeed[] = [
  {
    approved: false,
    company: "Northwind Labs",
    location: "Remote, London",
    score: 86,
    title: "Platform Engineer",
  },
  {
    approved: false,
    company: "Halden Systems",
    location: "Manchester, hybrid",
    savedOnly: true,
    score: 81,
    title: "Site Reliability Engineer",
  },
  {
    approved: true,
    company: "Larkspur Health",
    location: "Remote, UK",
    omitNotice: true,
    score: 78,
    title: "Senior Backend Engineer",
  },
];

async function moveClockTo(request: APIRequestContext) {
  const state = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  await request.post("/__test__/clock/offset", {
    data: { offsetMs: referenceNow - state.now },
  });
}

export async function seedProfile(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  const state = await verifyAuthState(appServerUrl, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error("the owner was not created");
  }

  await request.post("/api/running", { data: { running: true } });
  await request.put("/api/profile/settings", {
    data: { languages: ["en"], timezone: TIME_ZONE },
  });
  await request.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });
  await request.post("/__test__/ledger/sample", {
    data: { email: authTestIdentity.ownerEmail },
  });

  const resume = await request.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor-2026.pdf",
      },
    },
  });

  if (!resume.ok()) {
    throw new Error(`resume upload failed: ${String(resume.status())} ${await resume.text()}`);
  }

  const facts = await request.post("/__test__/facts/seed", {
    data: {
      facts: [
        { key: "legal_name", value: "Maya Okafor" },
        { key: "work_auth", scope: "GB", value: "Yes." },
        { key: "notice_period", value: "Two weeks" },
        { key: "years_total", source: "resume", value: "6" },
      ],
      userId: owner.id,
    },
  });

  if (!facts.ok()) {
    throw new Error(`fact seed failed: ${String(facts.status())} ${await facts.text()}`);
  }

  return owner.id;
}

async function questionIds(request: APIRequestContext, userId: string, postingId: string) {
  return z
    .object({
      questions: z.array(z.object({ questionId: z.string(), text: z.string() })),
    })
    .parse(
      await (
        await request.get(
          `/__test__/questions?userId=${encodeURIComponent(userId)}&postingId=${encodeURIComponent(postingId)}`,
        )
      ).json(),
    ).questions;
}

async function seedAnswers(
  request: APIRequestContext,
  applicationId: string,
  postingId: string,
  userId: string,
  company: string,
  title: string,
  savedOnly: boolean,
) {
  const ids = await questionIds(request, userId, postingId);
  const onCallQuestion = ids.find((question) => question.text.startsWith("Are you comfortable"));
  const coverQuestion = ids.find((question) => question.text === "Cover letter");

  if (onCallQuestion === undefined || coverQuestion === undefined) {
    throw new Error("the seeded posting is missing its open text questions");
  }

  await request.post("/__test__/application-answers", {
    data: {
      applicationId,
      kind: "open_text",
      questionId: onCallQuestion.questionId,
      sentences: [{ byUser: savedOnly, resumeLineIds: [], sentence: onCall }],
    },
  });

  await request.post("/__test__/application-answers", {
    data: {
      applicationId,
      kind: "cover_letter",
      questionId: coverQuestion.questionId,
      sentences: [
        {
          byUser: savedOnly,
          resumeLineIds: [],
          sentence: `Dear ${company} team, I am applying for the ${title} role. For the last four years I have built and run deploy pipelines for a payments team, and I would like to bring that work to your platform group.`,
        },
      ],
    },
  });
}

async function seedCard(request: APIRequestContext, userId: string, card: CardSeed, index: number) {
  const companyId = await seedCompany(request, card.company, `ready-${String(index)}.example`);
  const boardId = await seedBoard(request, companyId, "greenhouse", `ready-${String(index)}`);

  const postingQuestions = questions.flatMap((question) =>
    card.omitNotice === true && question.factKey === "notice_period"
      ? []
      : [
          {
            answerKind: question.answerKind,
            factKey: question.factKey ?? null,
            fieldName: null,
            fieldType: question.fieldType,
            options: [],
            required: question.required,
            text: question.text,
          },
        ],
  );

  const postingId = await seedPosting(request, {
    atsJobId: `ready-${String(index)}`,
    boardId,
    companyId,
    countryCode: "GB",
    locationRaw: card.location,
    questions: postingQuestions,
    title: card.title,
    url: `https://${String(index)}.example/jobs/ready`,
  });

  const applicationId = createdSchema.parse(
    await (
      await request.post("/__test__/applications/seed", {
        data: {
          boardPosition: index,
          createdAt: referenceNow - (cards.length - index) * 60 * 60_000,
          origin: "pick",
          postingId,
          stage: "ready",
          status: "ready",
          userId,
        },
      })
    ).json(),
  ).id;

  await request.post("/__test__/matches/seed", {
    data: {
      codeRank: index,
      postingId,
      reason: "Strong match against your resume. Over the usual bar for sending.",
      score: card.score,
      userId,
    },
  });

  await seedAnswers(
    request,
    applicationId,
    postingId,
    userId,
    card.company,
    card.title,
    card.savedOnly === true,
  );

  return { applicationId, card };
}

async function approve(request: APIRequestContext, applicationId: string) {
  const ready = z
    .object({
      cards: z.array(
        z.object({
          id: z.string(),
          plan: z.object({ planSha256: z.string() }).nullable(),
        }),
      ),
    })
    .parse(await (await request.get("/api/ready")).json());

  const target = ready.cards.find((card) => card.id === applicationId);

  if (target?.plan === null || target?.plan === undefined) {
    throw new Error("the approved card has no plan");
  }

  const response = await request.post(
    `/api/applications/${encodeURIComponent(applicationId)}/approve`,
    { data: { planSha256: target.plan.planSha256 } },
  );

  if (!response.ok()) {
    throw new Error(`approve failed: ${String(response.status())} ${await response.text()}`);
  }

  await request.post("/__test__/applications/status", {
    data: { applicationId, scheduledFor: sendAt, status: "approved" },
  });
}

export async function seedReady(request: APIRequestContext, appServerUrl: string) {
  await moveClockTo(request);
  const userId = await seedProfile(request, appServerUrl);

  await Promise.all(
    cards.map(async (card, index) => {
      const seeded = await seedCard(request, userId, card, index + 1);

      if (card.approved) {
        await approve(request, seeded.applicationId);
      }
    }),
  );

  return userId;
}

export async function readyStorageState(appServerUrl: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedReady(request, appServerUrl);
  const storageState = await request.storageState();

  await request.dispose();

  return storageState;
}
