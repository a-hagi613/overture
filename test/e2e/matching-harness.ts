import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import type { AnswerKind } from "../../src/shared/questions.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";
import { readSseEventUntil } from "./sse.ts";

const createdSchema = z.object({ id: z.string() });

const upNextSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  workplace: z.string(),
  employmentType: z.string(),
  salaryMinMinor: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: z.string().nullable(),
  codeRank: z.number(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
  strong: z.boolean(),
  saved: z.boolean(),
});

export const homeSchema = z.object({
  applicationsLeft: z.number(),
  planApplications: z.number(),
  sentToday: z.number(),
  dailyCap: z.number(),
  remainingToday: z.number(),
  upNext: z.array(upNextSchema),
});

export type Home = z.infer<typeof homeSchema>;

export type UpNext = z.infer<typeof upNextSchema>;

export const defaultTargets = {
  roles: ["Backend"],
  seniorities: ["senior"],
  workplaces: ["remote"],
  locations: ["Toronto, ON"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: 10_000_000,
  salaryCurrency: "CAD",
  salaryPeriod: "year",
};

export const basePosting = {
  ats: "greenhouse",
  workplace: "remote",
  employmentType: "full_time",
  language: "en",
  locationRaw: "Remote, Canada",
  countryCode: "CA",
  title: "Senior Backend Engineer",
  salaryMinMinor: 15_000_000,
  salaryCurrency: "CAD",
  salaryPeriod: "year",
  tags: [
    { dimension: "subrole", value: "Backend" },
    { dimension: "seniority", value: "senior" },
  ],
};

export async function ownerContextFor(appServerUrl: string) {
  const owner = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  await owner.get(link);

  const state = await verifyAuthState(appServerUrl, owner);

  return { owner, userId: state.users.at(-1)?.id ?? "" };
}

export async function clearCatalog(owner: APIRequestContext) {
  await owner.post("/__test__/catalog/postings/close-all", { data: {} });
}

export async function seedCompany(request: APIRequestContext, name: string, domain: string | null) {
  const response = await request.post("/__test__/catalog/companies", { data: { name, domain } });

  return createdSchema.parse(await response.json()).id;
}

export async function seedBoard(
  request: APIRequestContext,
  companyId: string,
  ats: "greenhouse" | "lever" | "ashby",
  boardToken: string,
) {
  const response = await request.post("/__test__/catalog/boards", {
    data: { ats, boardToken, companyId },
  });

  return createdSchema.parse(await response.json()).id;
}

export async function seedPosting(
  request: APIRequestContext,
  input: {
    boardId: string;
    companyId: string;
    atsJobId: string;
    url: string;
    title?: string;
    ats?: "greenhouse" | "lever" | "ashby";
    workplace?: "remote" | "hybrid" | "onsite" | "unknown";
    employmentType?: string;
    language?: string;
    locationRaw?: string;
    countryCode?: string | null;
    region?: string | null;
    city?: string | null;
    salaryMinMinor?: number | null;
    salaryCurrency?: string | null;
    salaryPeriod?: "year" | "month" | "hour" | null;
    postedAt?: number | null;
    descriptionText?: string | null;
    tags?: { dimension: "role" | "subrole" | "seniority"; value: string }[];
    questions?: {
      text: string;
      fieldName?: string | null;
      fieldType?:
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
      atsFieldType?: string;
      options?: string[];
      required?: boolean;
      factKey?: string | null;
      answerKind?: AnswerKind;
      mappedBy?: "rules" | "llm" | "owner" | null;
    }[];
  },
) {
  const data = {
    ...basePosting,
    ...input,
    tags: input.tags ?? basePosting.tags,
    questions: input.questions ?? [],
  };

  const response = await request.post("/__test__/catalog/postings", { data });

  return createdSchema.parse(await response.json()).id;
}

export async function configureMatching(
  owner: APIRequestContext,
  targets: typeof defaultTargets = defaultTargets,
) {
  await owner.put("/api/profile/languages", { data: { languages: ["en"] } });
  await owner.put("/api/profile/targets", { data: targets });
}

export async function grantApplications(request: APIRequestContext, quantity: number) {
  const response = await request.post("/__test__/ledger/grant", {
    data: {
      email: authTestIdentity.ownerEmail,
      idempotencyKey: `grant:${crypto.randomUUID()}`,
      quantity,
    },
  });

  await response.text();
}

export async function homeFor(owner: APIRequestContext) {
  return homeSchema.parse(await (await owner.get("/api/home")).json());
}

const jobEventSchema = z.object({ id: z.string() });

export async function runPrepDaily(
  request: APIRequestContext,
  appServerUrl: string,
  userId: string,
) {
  await request.post("/__test__/profile/running", { data: { running: true, userId } });

  const body: unknown = await (
    await request.post("/__test__/jobs/enqueue", {
      data: { kind: "prep.daily", payload: JSON.stringify({ userId }) },
    })
  ).json();

  const jobId = createdSchema.parse(body).id;

  await readSseEventUntil(`${appServerUrl}/api/events`, null, (event) => {
    if (event.event !== "job.done") {
      return false;
    }

    return jobEventSchema.parse(JSON.parse(event.data)).id === jobId;
  });
}

export async function seedApplication(
  request: APIRequestContext,
  input: {
    userId: string;
    postingId: string;
    status:
      | "preparing"
      | "needs_review"
      | "ready"
      | "approved"
      | "sending"
      | "confirming"
      | "sent"
      | "failed"
      | "skipped"
      | "withdrawn";
    sentAt?: number | null;
    createdAt?: number | null;
    readyAt?: number | null;
    scheduledFor?: number | null;
  },
) {
  const response = await request.post("/__test__/applications/seed", {
    data: {
      createdAt: input.createdAt ?? null,
      origin: "auto",
      readyAt: input.readyAt ?? null,
      scheduledFor: input.scheduledFor ?? null,
      sentAt: input.sentAt ?? null,
      status: input.status,
      postingId: input.postingId,
      userId: input.userId,
    },
  });

  return createdSchema.parse(await response.json()).id;
}

export function idsOf(home: Home) {
  return home.upNext.map((candidate) => candidate.id);
}

const readyCardSchema = z.object({
  id: z.string(),
  plan: z.object({ planSha256: z.string() }).nullable(),
  status: z.string(),
});

const readySchema = z.object({ cards: z.array(readyCardSchema) });

export async function readyCards(request: APIRequestContext) {
  return readySchema.parse(await (await request.get("/api/ready")).json()).cards;
}

export async function planShaFor(request: APIRequestContext, applicationId: string) {
  const card = (await readyCards(request)).find((candidate) => candidate.id === applicationId);

  if (card?.plan === null || card?.plan === undefined) {
    throw new Error(`the Ready card ${applicationId} has no plan`);
  }

  return card.plan.planSha256;
}

export async function approveApplication(request: APIRequestContext, applicationId: string) {
  const response = await request.post(
    `/api/applications/${encodeURIComponent(applicationId)}/approve`,
    { data: { planSha256: await planShaFor(request, applicationId) } },
  );

  if (!response.ok()) {
    throw new Error(`approving ${applicationId} failed: ${await response.text()}`);
  }

  return z.object({ planSha256: z.string(), status: z.string() }).parse(await response.json());
}

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });

export async function clockNow(owner: APIRequestContext) {
  return clockSchema.parse(await (await owner.get("/__test__/clock")).json()).now;
}

const boardsSchema = z.object({
  boards: z.array(z.object({ ats: z.string(), companyId: z.string(), id: z.string() })),
});

export async function boardIdFor(
  owner: APIRequestContext,
  companyId: string,
  ats: "greenhouse" | "lever" | "ashby",
) {
  const boards = boardsSchema.parse(await (await owner.get("/__test__/catalog/boards")).json());

  return (
    boards.boards.find((board) => board.companyId === companyId && board.ats === ats)?.id ?? ""
  );
}
