import { expect, request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import type { Ats } from "../../src/shared/ats.ts";
import type { AnswerKind } from "../../src/shared/questions.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

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
});

export const upNextSchemaList = z.object({ items: z.array(upNextSchema) });

export type Home = z.infer<typeof homeSchema> & { upNext: UpNext[] };

export type UpNext = z.infer<typeof upNextSchema>;

export const defaultTargets = {
  roles: ["Backend"],
  unresolvedRoles: [],
  locations: ["city:ca:toronto"],
  unresolvedLocations: [],
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

/**
 * Creates a verified owner user without mail, for a server whose mail sender is a fixture rather than the sink.
 * @param appServerUrl The running app server to seed.
 * @returns An API context with the owner row already created and promoted.
 */
export async function seedOwner(appServerUrl: string) {
  const owner = await apiRequest.newContext({ baseURL: appServerUrl });

  const created = await owner.post("/__test__/users", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  const { id } = createdSchema.parse(await created.json());

  await owner.post("/__test__/auth/role", { data: { role: "owner", userId: id } });

  return { owner, userId: id };
}

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
  ats: Ats,
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
    applyUrl?: string | null;
    title?: string;
    ats?: Ats;
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
  const response = await owner.get("/api/home");

  expect(response.ok()).toBe(true);

  const home = homeSchema.parse(await response.json());

  const candidates = upNextSchemaList.parse(
    await (await owner.get("/api/matching/up-next")).json(),
  );

  return { ...home, upNext: candidates.items };
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
      origin: "pick",
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

export async function clockState(owner: APIRequestContext) {
  return clockSchema.parse(await (await owner.get("/__test__/clock")).json());
}

export async function clockNow(owner: APIRequestContext) {
  return (await clockState(owner)).now;
}

/**
 * Point the server clock at `at`, keeping any offset already applied so moving
 * it again never compounds. Callers move forward: moving back rewinds the
 * instant earlier writes happened at.
 * @param owner The request context for the app server.
 * @param at The instant the clock should read.
 */
export async function moveClockTo(owner: APIRequestContext, at: number) {
  const { now, offsetMs } = await clockState(owner);

  const response = await owner.post("/__test__/clock/offset", {
    data: { offsetMs: offsetMs + (at - now) },
  });

  if (!response.ok()) {
    throw new Error(`moving the clock to ${String(at)} failed: ${await response.text()}`);
  }
}

const boardsSchema = z.object({
  boards: z.array(z.object({ ats: z.string(), companyId: z.string(), id: z.string() })),
});

export async function boardIdFor(
  owner: APIRequestContext,
  companyId: string,
  ats: "greenhouse" | "lever" | "ashby" | "workable",
) {
  const boards = boardsSchema.parse(await (await owner.get("/__test__/catalog/boards")).json());

  return (
    boards.boards.find((board) => board.companyId === companyId && board.ats === ats)?.id ?? ""
  );
}
