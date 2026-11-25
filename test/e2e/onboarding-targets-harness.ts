import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const createdSchema = z.object({ id: z.string() });

const boardTargets = {
  roles: ["Platform Engineer", "Backend Engineer", "Site Reliability Engineer"],
  seniorities: ["senior", "staff"],
  workplaces: ["remote", "hybrid"],
  locations: ["London", "Remote, UK"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: 14_000_000,
  salaryCurrency: "CAD",
  salaryPeriod: "year",
};

interface LocationSlot {
  city: string | null;
  countryCode: string;
  locationRaw: string;
  workplace: "remote" | "hybrid";
}

const locationSlots: { count: number; slot: LocationSlot }[] = [
  {
    count: 120,
    slot: {
      city: "London",
      countryCode: "GB",
      locationRaw: "London, England, United Kingdom",
      workplace: "hybrid",
    },
  },
  {
    count: 110,
    slot: {
      city: null,
      countryCode: "GB",
      locationRaw: "Remote, UK",
      workplace: "remote",
    },
  },
  {
    count: 50,
    slot: {
      city: "Berlin",
      countryCode: "DE",
      locationRaw: "Berlin, Germany",
      workplace: "hybrid",
    },
  },
  {
    count: 38,
    slot: {
      city: "Amsterdam",
      countryCode: "NL",
      locationRaw: "Amsterdam, Netherlands",
      workplace: "remote",
    },
  },
];

const roleCounts: {
  count: number;
  employmentType: "full_time" | "part_time";
  role: string;
}[] = [
  { count: 80, employmentType: "full_time", role: "Platform Engineer" },
  { count: 70, employmentType: "full_time", role: "Backend Engineer" },
  { count: 63, employmentType: "full_time", role: "Site Reliability Engineer" },
  { count: 40, employmentType: "part_time", role: "DevOps Engineer" },
  { count: 35, employmentType: "part_time", role: "Data Engineer" },
  { count: 30, employmentType: "part_time", role: "AI Engineer" },
];

interface PostingSeed {
  ats: "greenhouse";
  atsJobId: string;
  boardId: string;
  city: string | null;
  companyId: string;
  countryCode: string;
  employmentType: "full_time" | "part_time";
  language: string;
  locationRaw: string;
  tags: { dimension: "role" | "seniority" | "granular_role"; value: string }[];
  title: string;
  url: string;
  workplace: "onsite" | "remote" | "hybrid";
}

interface SeedRequest {
  [field: string]: string | number | null | SeedRequest | (string | number | SeedRequest)[];
}

async function created(request: APIRequestContext, path: string, data: SeedRequest) {
  const response = await request.post(path, { data });

  if (!response.ok()) {
    throw new Error(`${path} failed: ${String(response.status())} ${await response.text()}`);
  }

  return createdSchema.parse(await response.json()).id;
}

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  const state = await verifyAuthState(appServerUrl, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error("the owner was not created");
  }

  return owner.id;
}

async function seedBoard(request: APIRequestContext) {
  const companyId = await created(request, "/__test__/catalog/companies", {
    domain: "onboarding-targets.example",
    name: "Onboarding Targets Co",
  });

  const boardId = await created(request, "/__test__/catalog/boards", {
    ats: "greenhouse",
    boardToken: "onboarding-targets",
    companyId,
  });

  return { boardId, companyId };
}

function expand<T>(rows: { count: number; value: T }[]) {
  return rows.flatMap((row) => Array.from({ length: row.count }, () => row.value));
}

function boardPostings(board: { boardId: string; companyId: string }) {
  const roles = expand(
    roleCounts.map((row) => ({
      count: row.count,
      value: { employmentType: row.employmentType, role: row.role },
    })),
  );

  const locations = expand(
    locationSlots.map((row) => ({
      count: row.count,
      value: row.slot,
    })),
  );

  const postings = roles.map((mapping, index) => {
    const slot = locations[index];

    if (slot === undefined) {
      throw new Error("a posting has no location");
    }

    return {
      ats: "greenhouse",
      atsJobId: `onboarding-targets-${String(index)}`,
      boardId: board.boardId,
      city: slot.city,
      companyId: board.companyId,
      countryCode: slot.countryCode,
      employmentType: mapping.employmentType,
      language: "en",
      locationRaw: slot.locationRaw,
      tags: [
        { dimension: "role", value: mapping.role },
        { dimension: "seniority", value: index % 2 === 0 ? "senior" : "staff" },
      ],
      title: mapping.role,
      url: `https://onboarding-targets.example/${String(index)}`,
      workplace: slot.workplace,
    } satisfies PostingSeed;
  });

  return postings satisfies PostingSeed[];
}

function otherSeniorityPostings(board: { boardId: string; companyId: string }) {
  const rows: { count: number; seniority: string }[] = [
    { count: 5, seniority: "mid" },
    { count: 3, seniority: "principal" },
  ];

  return rows.flatMap((row) =>
    Array.from({ length: row.count }, (_, index) => ({
      ats: "greenhouse" as const,
      atsJobId: `onboarding-targets-${row.seniority}-${String(index)}`,
      boardId: board.boardId,
      city: "London",
      companyId: board.companyId,
      countryCode: "GB",
      employmentType: "full_time" as const,
      language: "en",
      locationRaw: "London, England, United Kingdom",
      tags: [
        { dimension: "role" as const, value: "DevOps Engineer" },
        { dimension: "seniority" as const, value: row.seniority },
      ],
      title: "DevOps Engineer",
      url: `https://onboarding-targets.example/seniority/${row.seniority}/${String(index)}`,
      workplace: "onsite" as const,
    })),
  ) satisfies PostingSeed[];
}

async function seedPostings(request: APIRequestContext, postings: PostingSeed[]) {
  const response = await request.post("/__test__/catalog/postings/bulk", {
    data: { postings },
  });

  if (!response.ok()) {
    throw new Error(`posting seed failed: ${String(response.status())} ${await response.text()}`);
  }
}

async function seedGhostRole(
  request: APIRequestContext,
  board: { boardId: string; companyId: string },
) {
  const id = await created(request, "/__test__/catalog/postings", {
    ats: "greenhouse",
    atsJobId: "onboarding-targets-ghost",
    boardId: board.boardId,
    companyId: board.companyId,
    employmentType: "full_time",
    language: "en",
    locationRaw: "London, England, United Kingdom",
    city: "London",
    countryCode: "GB",
    tags: [{ dimension: "role", value: "Ghost Role" }],
    title: "Ghost Role",
    url: "https://onboarding-targets.example/ghost",
    workplace: "hybrid",
  });

  const closed = await request.post("/__test__/catalog/postings/close", { data: { id } });

  if (!closed.ok()) {
    throw new Error(`closing the ghost posting failed: ${String(closed.status())}`);
  }
}

export async function seedOnboardingTargetsBoard(request: APIRequestContext, appServerUrl: string) {
  const userId = await seedOwner(request, appServerUrl);
  const board = await seedBoard(request);

  await request.post("/__test__/catalog/postings/close-all");
  await seedPostings(request, [...boardPostings(board), ...otherSeniorityPostings(board)]);
  await seedGhostRole(request, board);

  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: boardTargets });

  return { userId };
}

export async function seedOnboardingTargetsFlow(request: APIRequestContext, appServerUrl: string) {
  const userId = await seedOwner(request, appServerUrl);
  const board = await seedBoard(request);

  const postings: PostingSeed[] = [
    {
      ats: "greenhouse",
      atsJobId: "flow-platform-1",
      boardId: board.boardId,
      city: "London",
      companyId: board.companyId,
      countryCode: "GB",
      employmentType: "full_time",
      language: "en",
      locationRaw: "London, England, United Kingdom",
      tags: [
        { dimension: "role", value: "Platform Engineer" },
        { dimension: "seniority", value: "senior" },
      ],
      title: "Platform Engineer",
      url: "https://onboarding-targets.example/flow-1",
      workplace: "remote",
    },
    {
      ats: "greenhouse",
      atsJobId: "flow-platform-2",
      boardId: board.boardId,
      city: "London",
      companyId: board.companyId,
      countryCode: "GB",
      employmentType: "full_time",
      language: "en",
      locationRaw: "London, England, United Kingdom",
      tags: [
        { dimension: "role", value: "Platform Engineer" },
        { dimension: "seniority", value: "senior" },
      ],
      title: "Platform Engineer",
      url: "https://onboarding-targets.example/flow-2",
      workplace: "remote",
    },
    {
      ats: "greenhouse",
      atsJobId: "flow-platform-3",
      boardId: board.boardId,
      city: "London",
      companyId: board.companyId,
      countryCode: "GB",
      employmentType: "full_time",
      language: "en",
      locationRaw: "London, England, United Kingdom",
      tags: [
        { dimension: "role", value: "Platform Engineer" },
        { dimension: "seniority", value: "senior" },
      ],
      title: "Platform Engineer",
      url: "https://onboarding-targets.example/flow-3",
      workplace: "remote",
    },
    {
      ats: "greenhouse",
      atsJobId: "flow-manager-1",
      boardId: board.boardId,
      city: "London",
      companyId: board.companyId,
      countryCode: "GB",
      employmentType: "full_time",
      language: "en",
      locationRaw: "London, England, United Kingdom",
      tags: [
        { dimension: "role", value: "Product Manager" },
        { dimension: "seniority", value: "senior" },
      ],
      title: "Product Manager",
      url: "https://onboarding-targets.example/flow-4",
      workplace: "hybrid",
    },
    {
      ats: "greenhouse",
      atsJobId: "flow-manager-2",
      boardId: board.boardId,
      city: "Berlin",
      companyId: board.companyId,
      countryCode: "DE",
      employmentType: "full_time",
      language: "en",
      locationRaw: "Berlin, Germany",
      tags: [
        { dimension: "role", value: "Product Manager" },
        { dimension: "seniority", value: "senior" },
      ],
      title: "Product Manager",
      url: "https://onboarding-targets.example/flow-5",
      workplace: "hybrid",
    },
    {
      ats: "greenhouse",
      atsJobId: "flow-granular-nurse",
      boardId: board.boardId,
      city: "London",
      companyId: board.companyId,
      countryCode: "GB",
      employmentType: "full_time",
      language: "en",
      locationRaw: "London, England, United Kingdom",
      tags: [
        { dimension: "role", value: "Healthcare" },
        { dimension: "granular_role", value: "Registered Nurse" },
        { dimension: "seniority", value: "senior" },
      ],
      title: "Registered Nurse",
      url: "https://onboarding-targets.example/flow-6",
      workplace: "hybrid",
    },
  ];

  await request.post("/__test__/catalog/postings/close-all");
  await seedPostings(request, postings);
  await seedGhostRole(request, board);

  return { userId };
}

export { boardTargets };

export async function seedOnsitePosting(request: APIRequestContext) {
  const companyId = await created(request, "/__test__/catalog/companies", {
    domain: "onsite-clinic.example",
    name: "Onsite Clinic",
  });

  const boardId = await created(request, "/__test__/catalog/boards", {
    ats: "greenhouse",
    boardToken: "onsite-clinic",
    companyId,
  });

  await seedPostings(request, [
    {
      ats: "greenhouse",
      atsJobId: "onsite-clinic-1",
      boardId,
      city: "London",
      companyId,
      countryCode: "GB",
      employmentType: "full_time",
      language: "en",
      locationRaw: "London, England, United Kingdom",
      tags: [
        { dimension: "role", value: "Platform Engineer" },
        { dimension: "seniority", value: "senior" },
      ],
      title: "Platform Engineer",
      url: "https://onsite-clinic.example/1",
      workplace: "onsite",
    },
  ]);
}
