import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import {
  clearCatalog,
  clockNow,
  configureMatching,
  grantApplications,
  ownerContextFor,
  runMatchFill,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{ matching: { anthropic: AnthropicFixtureServer; server: AppServer } }>(
  {
    matching: [
      async ({ identityServer }, provide) => {
        const anthropic = await startAnthropicFixtureServer();

        const server = await startFreshAppServer(identityServer, {
          ANTHROPIC_API_KEY: "test-anthropic-key",
          ANTHROPIC_BASE_URL: anthropic.url,
        });

        await provide({ anthropic, server });
        await server.stop();
        anthropic.stop();
      },
      { scope: "test" },
    ],
  },
);

const matchRowSchema = z.object({
  postingId: z.string(),
  codeRank: z.number(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
});

const matchesSchema = z.object({ matches: z.array(matchRowSchema) });

const applicationRowSchema = z.object({
  id: z.string(),
  postingId: z.string(),
  origin: z.enum(["auto", "manual"]),
  status: z.string(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const postingSchema = z.object({
  id: z.string(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
  applicationId: z.string().nullable(),
});

const appliedSchema = z.object({ applicationId: z.string(), created: z.boolean() });

async function seedCompanies(
  owner: APIRequestContext,
  prefix: string,
  count: number,
  extra: { salaryMinMinor: number | null; postedAt?: number },
) {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const name = `${prefix} ${String(index)}`;
      const companyId = await seedCompany(owner, name, `${prefix}-${String(index)}.example`);
      const boardId = await seedBoard(owner, companyId, "greenhouse", `${prefix}-${String(index)}`);

      return seedPosting(owner, {
        atsJobId: `${prefix}-${String(index)}`,
        boardId,
        companyId,
        postedAt: extra.postedAt === undefined ? null : extra.postedAt - index * 1000,
        salaryMinMinor: extra.salaryMinMinor,
        salaryCurrency: extra.salaryMinMinor === null ? null : "CAD",
        title: "Senior Backend Engineer",
        url: `https://${prefix}-${String(index)}.example/1`,
      });
    }),
  );
}

async function matchesFor(owner: APIRequestContext, userId: string) {
  const body: unknown = await (
    await owner.get(`/__test__/matches?userId=${encodeURIComponent(userId)}`)
  ).json();

  return matchesSchema.parse(body).matches;
}

async function applicationsFor(owner: APIRequestContext, userId: string) {
  const body: unknown = await (
    await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)
  ).json();

  return applicationsSchema.parse(body).applications;
}

test("scoring fills today's slots plus a buffer in rank order and never scores twice", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const now = await clockNow(owner);

  const paid = await seedCompanies(owner, "paid", 10, {
    postedAt: now - 20 * 86_400_000,
    salaryMinMinor: 15_000_000,
  });

  const unpaid = await seedCompanies(owner, "unpaid", 10, {
    postedAt: now - 15 * 86_400_000,
    salaryMinMinor: null,
  });

  await runMatchFill(owner, matching.server.url);

  const applications = await applicationsFor(owner, userId);
  const matches = await matchesFor(owner, userId);
  const scored = matches.filter((row) => row.score !== null);

  expect(applications).toHaveLength(15);
  expect(scored).toHaveLength(15);
  expect(matching.anthropic.requests()).toHaveLength(15);

  for (const id of paid) {
    expect(scored.some((row) => row.postingId === id)).toBe(true);
  }

  for (const id of unpaid.slice(0, 5)) {
    expect(scored.some((row) => row.postingId === id)).toBe(true);
  }

  for (const id of unpaid.slice(5)) {
    expect(scored.some((row) => row.postingId === id)).toBe(false);
  }

  const reasons = scored.map((row) => row.reason);

  expect(reasons.every((reason) => reason !== null && reason.length <= 140)).toBe(true);

  await runMatchFill(owner, matching.server.url);

  expect(await applicationsFor(owner, userId)).toHaveLength(15);
  expect((await matchesFor(owner, userId)).filter((row) => row.score !== null)).toHaveLength(15);
  expect(matching.anthropic.requests()).toHaveLength(15);

  await owner.dispose();
});

test("opening a posting scores it once, and manual apply works below the threshold", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const strongCompany = await seedCompany(owner, "Strong Co", "strong.example");
  const strongBoard = await seedBoard(owner, strongCompany, "greenhouse", "strong");

  const strong = await seedPosting(owner, {
    atsJobId: "strong",
    boardId: strongBoard,
    companyId: strongCompany,
    title: "Data Backend Engineer",
    url: "https://strong.example/1",
  });

  const weakCompany = await seedCompany(owner, "Weak Co", "weak.example");
  const weakBoard = await seedBoard(owner, weakCompany, "greenhouse", "weak");

  const weak = await seedPosting(owner, {
    atsJobId: "weak",
    boardId: weakBoard,
    companyId: weakCompany,
    title: "Junior Backend Engineer",
    url: "https://weak.example/1",
  });

  const strongPosting = postingSchema.parse(
    await (await owner.get(`/api/postings/${strong}`)).json(),
  );

  expect(strongPosting.score).toBe(87);
  expect(strongPosting.reason).toContain("pipelines");
  expect(strongPosting.applicationId).not.toBeNull();
  expect(matching.anthropic.requests()).toHaveLength(1);

  const weakFirst = postingSchema.parse(await (await owner.get(`/api/postings/${weak}`)).json());

  expect(weakFirst.score).toBe(35);
  expect(weakFirst.applicationId).toBeNull();
  expect(matching.anthropic.requests()).toHaveLength(2);

  const reopened = postingSchema.parse(await (await owner.get(`/api/postings/${strong}`)).json());

  expect(reopened.score).toBe(87);
  expect(matching.anthropic.requests()).toHaveLength(2);

  const manual = appliedSchema.parse(
    await (await owner.post(`/api/postings/${weak}/apply`, { data: {} })).json(),
  );

  expect(manual.created).toBe(true);

  const application = (await applicationsFor(owner, userId)).find((row) => row.postingId === weak);

  expect(application?.origin).toBe("manual");
  expect(application?.status).toBe("preparing");

  await owner.put("/api/profile/targets", {
    data: {
      roles: ["Backend"],
      seniorities: ["staff"],
      workplaces: ["remote"],
      locations: ["Toronto, ON"],
      employmentTypes: ["full_time"],
      salaryFloorMinor: 10_000_000,
      salaryCurrency: "CAD",
      salaryPeriod: "year",
    },
  });

  await owner.get(`/api/postings/${strong}`);

  expect(matching.anthropic.requests()).toHaveLength(3);

  await owner.dispose();
});

test("an application is created only for a score at or above the threshold", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  async function seededPosting(title: string) {
    const name = title.replaceAll(" ", "");
    const companyId = await seedCompany(owner, `${name} Co`, `${name.toLowerCase()}.example`);
    const boardId = await seedBoard(owner, companyId, "greenhouse", name.toLowerCase());

    const id = await seedPosting(owner, {
      atsJobId: name,
      boardId,
      companyId,
      title,
      url: `https://${name.toLowerCase()}.example/1`,
    });

    return { id, title };
  }

  const seeded = await Promise.all(
    ["Senior Backend Engineer", "Backend Engineer", "Junior Backend Engineer"].map(async (title) =>
      seededPosting(title),
    ),
  );

  await runMatchFill(owner, matching.server.url);

  const applications = await applicationsFor(owner, userId);
  const matches = await matchesFor(owner, userId);

  expect(matches.filter((row) => row.score !== null)).toHaveLength(3);
  expect(applications).toHaveLength(1);
  expect(applications.at(0)?.postingId).toBe(seeded.at(0)?.id);

  await owner.dispose();
});
