import { readFileSync } from "node:fs";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startGreenhouseQuestionsFixture } from "./greenhouse-questions.fixture.ts";
import {
  clearCatalog,
  clockNow,
  configureMatching,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{
  matching: {
    anthropic: AnthropicFixtureServer;
    questions: ReturnType<typeof startGreenhouseQuestionsFixture>;
    server: AppServer;
  };
}>({
  matching: [
    async ({ identityServer }, provide) => {
      const anthropic = await startAnthropicFixtureServer();
      const questions = startGreenhouseQuestionsFixture();

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        GREENHOUSE_FEED_BASE_URL: questions.url,
      });

      await provide({ anthropic, questions, server });
      await server.stop();
      anthropic.stop();
      questions.stop();
    },
    { scope: "test" },
  ],
});

const applicationRowSchema = z.object({
  id: z.string(),
  postingId: z.string(),
  origin: z.enum(["pick", "manual"]),
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

async function applicationsFor(owner: APIRequestContext, userId: string) {
  const body: unknown = await (
    await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)
  ).json();

  return applicationsSchema.parse(body).applications;
}

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
    descriptionText: "We build distributed systems on Kubernetes and Postgres for payments teams.",
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
  expect(strongPosting.applicationId).toBeNull();
  expect(matching.anthropic.requests()).toHaveLength(1);
  expect(matching.anthropic.requests().at(0)?.user).toContain(
    "distributed systems on Kubernetes and Postgres",
  );

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
  expect(["preparing", "ready"]).toContain(application?.status);

  await owner.put("/api/profile/targets", {
    data: {
      roles: ["Backend"],
      unresolvedRoles: [],
      locations: ["city:ca:toronto", "city:ca:vancouver"],
      unresolvedLocations: [],
    },
  });

  const rescored = postingSchema.parse(await (await owner.get(`/api/postings/${strong}`)).json());

  expect(rescored.score).toBe(87);
  expect(matching.anthropic.requests()).toHaveLength(3);
  expect(matching.anthropic.requests().at(2)?.user).toContain(
    "Toronto, Ontario, Canada or Vancouver, British Columbia, Canada",
  );

  const reopenedAgain = postingSchema.parse(
    await (await owner.get(`/api/postings/${strong}`)).json(),
  );

  expect(reopenedAgain.score).toBe(87);
  expect(matching.anthropic.requests()).toHaveLength(3);

  await owner.dispose();
});

test("manual Apply refuses every hard filter and scores only what it may apply to", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const upload = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "resume.pdf",
      },
    },
  });

  expect(upload.status()).toBe(201);

  await owner.put("/api/profile/skip-companies", {
    data: { companies: [{ domain: "fenwick.example", name: "Fenwick & Marsh" }] },
  });

  const now = await clockNow(owner);

  async function companyWithPostings(company: string, titles: string[]) {
    const companyId = await seedCompany(
      owner,
      company,
      `${company.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}.example`,
    );

    const boardId = await seedBoard(
      owner,
      companyId,
      "greenhouse",
      company.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and"),
    );

    return Promise.all(
      titles.map(async (title, index) =>
        seedPosting(owner, {
          atsJobId: `${company}-${String(index)}`,
          boardId,
          companyId,
          title,
          url: `https://example.test/${company}/${String(index)}`,
        }),
      ),
    );
  }

  const skipped = await companyWithPostings("Fenwick & Marsh", ["Senior Backend Engineer"]);
  const employer = await companyWithPostings("Brightwave Analytics", ["Senior Backend Engineer"]);
  const closed = await companyWithPostings("Closed Co", ["Senior Backend Engineer"]);

  const repost = await companyWithPostings("Repost Co", [
    "Repost Backend Engineer",
    "Repost Backend Engineer",
  ]);

  const openCompany = await companyWithPostings("Open Co", [
    "Backend Engineer",
    "Platform Backend Engineer",
  ]);

  const cooldown = await companyWithPostings("Cooldown Co", [
    "Staff Backend Engineer",
    "Data Backend Engineer",
  ]);

  const allowed = await companyWithPostings("Allowed Co", ["Junior Backend Engineer"]);

  await owner.post("/__test__/catalog/postings/close", { data: { id: closed[0] } });

  await seedApplication(owner, {
    postingId: repost[0] ?? "",
    sentAt: now - 40 * 86_400_000,
    status: "sent",
    userId,
  });
  await seedApplication(owner, { postingId: openCompany[1] ?? "", status: "preparing", userId });
  await seedApplication(owner, {
    postingId: cooldown[1] ?? "",
    sentAt: now - 3 * 86_400_000,
    status: "sent",
    userId,
  });

  const refusals: { id: string; reason: string }[] = [
    { id: skipped[0] ?? "", reason: "skip_list" },
    { id: employer[0] ?? "", reason: "current_employer" },
    { id: closed[0] ?? "", reason: "closed" },
    { id: repost[1] ?? "", reason: "repost_guard" },
    { id: openCompany[0] ?? "", reason: "open_application_company" },
    { id: cooldown[0] ?? "", reason: "company_cooldown" },
  ];

  await Promise.all(
    refusals.map(async (refusal) => {
      const response = await owner.post(`/api/postings/${refusal.id}/apply`, { data: {} });

      expect(response.status()).toBe(409);
      expect(
        z.object({ error: z.literal("filtered"), reason: z.string() }).parse(await response.json())
          .reason,
      ).toBe(refusal.reason);
    }),
  );

  expect(matching.anthropic.requests()).toHaveLength(0);

  const skippedPosting = postingSchema.parse(
    await (await owner.get(`/api/postings/${skipped[0] ?? ""}`)).json(),
  );

  expect(skippedPosting.score).toBeNull();
  expect(skippedPosting.reason).toBeNull();
  expect(matching.anthropic.requests()).toHaveLength(0);

  const allowedResponse = await owner.post(`/api/postings/${allowed[0] ?? ""}/apply`, { data: {} });

  expect(allowedResponse.status()).toBe(200);
  expect(appliedSchema.parse(await allowedResponse.json()).created).toBe(true);
  expect(matching.anthropic.requests()).toHaveLength(1);

  const applications = await applicationsFor(owner, userId);
  const refusedIds = new Set(refusals.map((refusal) => refusal.id));

  expect(applications.some((row) => refusedIds.has(row.postingId))).toBe(false);
  expect(applications.find((row) => row.postingId === allowed[0])?.origin).toBe("manual");

  await owner.dispose();
});
