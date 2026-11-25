import { readFileSync } from "node:fs";

import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const targetsSchema = z.object({
  roles: z.array(z.string()),
  seniorities: z.array(z.string()),
  workplaces: z.array(z.string()),
  locations: z.array(z.string()),
  employmentTypes: z.array(z.string()),
  salaryFloorMinor: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: z.string(),
});

const targetsResponseSchema = z.object({
  targets: targetsSchema,
  version: z.number(),
  matchedCount: z.number(),
});

const matchCountSchema = z.object({ matchedCount: z.number() });

const skipCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  reason: z.enum(["current_employer", "user"]),
});

const skipCompaniesSchema = z.object({ companies: z.array(skipCompanySchema) });

const languagesSchema = z.object({ languages: z.array(z.string()) });

const profileSettingsSchema = z.object({
  languages: z.array(z.string()),
  timezone: z.string().nullable(),
});

const factsSchema = z.object({
  facts: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      source: z.string(),
      confirmed: z.boolean(),
      revision: z.number(),
    }),
  ),
});

const createdSchema = z.object({ id: z.string() });
const bulkSchema = z.object({ created: z.number() });

const baseTargets = {
  roles: ["Backend"],
  seniorities: ["senior"],
  workplaces: ["onsite"],
  locations: ["Ottawa, ON"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: 14_000_000,
  salaryCurrency: "CAD",
  salaryPeriod: "year",
};

async function ownerContextFor(appServerUrl: string) {
  const owner = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  await owner.get(link);

  const state = await verifyAuthState(appServerUrl, owner);

  expect(state.users.at(-1)?.role).toBe("owner");
  expect(state.sessions).toHaveLength(1);

  return owner;
}

async function seedPostings(appServerUrl: string) {
  const company = createdSchema.parse(
    await (
      await fetch(`${appServerUrl}/__test__/catalog/companies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Target Co", domain: "targetco.example" }),
      })
    ).json(),
  );

  const board = createdSchema.parse(
    await (
      await fetch(`${appServerUrl}/__test__/catalog/boards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          ats: "greenhouse",
          boardToken: "target-co",
        }),
      })
    ).json(),
  );

  const common = {
    boardId: board.id,
    companyId: company.id,
    ats: "greenhouse",
    workplace: "onsite",
    employmentType: "full_time",
    language: "fr",
    countryCode: "CA",
    region: "Ontario",
    city: "Ottawa",
  };

  const postings = [
    {
      ...common,
      atsJobId: "target-1",
      url: "https://targetco.example/1",
      title: "Senior Backend Engineer",
      salaryMinMinor: 15_000_000,
      salaryCurrency: "CAD",
      tags: [
        { dimension: "subrole", value: "Backend" },
        { dimension: "seniority", value: "senior" },
      ],
    },
    {
      ...common,
      atsJobId: "target-2",
      url: "https://targetco.example/2",
      title: "Backend Engineer",
      region: "British Columbia",
      city: "Vancouver",
      salaryMinMinor: 10_000_000,
      salaryCurrency: "CAD",
      tags: [
        { dimension: "subrole", value: "Backend" },
        { dimension: "seniority", value: "mid" },
      ],
    },
    {
      ...common,
      atsJobId: "target-3",
      url: "https://targetco.example/3",
      title: "Frontend Engineer",
      employmentType: "contract",
      tags: [
        { dimension: "subrole", value: "Frontend" },
        { dimension: "seniority", value: "senior" },
      ],
    },
    {
      ...common,
      atsJobId: "target-4",
      url: "https://targetco.example/4",
      title: "Platform Backend Engineer",
      tags: [
        { dimension: "subrole", value: "Backend" },
        { dimension: "seniority", value: "senior" },
      ],
    },
    {
      ...common,
      atsJobId: "target-5",
      url: "https://targetco.example/5",
      title: "Infrastructure Backend Engineer",
      salaryMinMinor: 9_000_000,
      salaryCurrency: "CAD",
      tags: [
        { dimension: "subrole", value: "Backend" },
        { dimension: "seniority", value: "senior" },
      ],
    },
  ];

  const seeded = await fetch(`${appServerUrl}/__test__/catalog/postings/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postings }),
  });

  expect(bulkSchema.parse(await seeded.json()).created).toBe(postings.length);
}

test("the live count changes as targets change, and a draft count stores nothing", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  await seedPostings(appServerUrl);

  const languages = await owner.put("/api/profile/languages", {
    data: { languages: ["fr"] },
  });

  expect(languagesSchema.parse(await languages.json()).languages).toEqual(["fr"]);

  const saved = targetsResponseSchema.parse(
    await (
      await owner.put("/api/profile/targets", {
        data: baseTargets,
      })
    ).json(),
  );

  expect(saved.matchedCount).toBe(2);
  expect(saved.targets.roles).toEqual(["Backend"]);
  expect(saved.targets.salaryFloorMinor).toBe(14_000_000);
  expect(saved.targets.salaryCurrency).toBe("CAD");

  const midDraft = matchCountSchema.parse(
    await (
      await owner.post("/api/profile/targets/match-count", {
        data: { ...baseTargets, seniorities: ["mid"] },
      })
    ).json(),
  );

  expect(midDraft.matchedCount).toBe(0);

  const unchanged = targetsResponseSchema.parse(
    await (await owner.get("/api/profile/targets")).json(),
  );

  expect(unchanged.matchedCount).toBe(2);
  expect(unchanged.targets.seniorities).toEqual(["senior"]);

  const noFloor = targetsResponseSchema.parse(
    await (
      await owner.put("/api/profile/targets", {
        data: { ...baseTargets, salaryFloorMinor: null, salaryCurrency: null },
      })
    ).json(),
  );

  expect(noFloor.matchedCount).toBe(3);

  const remote = targetsResponseSchema.parse(
    await (
      await owner.put("/api/profile/targets", {
        data: { ...noFloor.targets, workplaces: ["remote"] },
      })
    ).json(),
  );

  expect(remote.matchedCount).toBe(0);

  const frontend = targetsResponseSchema.parse(
    await (
      await owner.put("/api/profile/targets", {
        data: {
          ...baseTargets,
          roles: ["Frontend"],
          employmentTypes: ["contract"],
          salaryFloorMinor: null,
          salaryCurrency: null,
        },
      })
    ).json(),
  );

  expect(frontend.matchedCount).toBe(1);

  await owner.put("/api/profile/languages", { data: { languages: ["en"] } });

  const englishOnly = targetsResponseSchema.parse(
    await (
      await owner.put("/api/profile/targets", {
        data: { ...noFloor.targets, roles: ["Backend"] },
      })
    ).json(),
  );

  expect(englishOnly.matchedCount).toBe(0);

  const rejected = await owner.put("/api/profile/targets", {
    data: { ...baseTargets, salaryFloorMinor: 14_000_000, salaryCurrency: null },
  });

  expect(rejected.status()).toBe(400);

  const anonymous = await apiRequest.newContext({ baseURL: appServerUrl });

  expect((await anonymous.get("/api/profile/targets")).status()).toBe(401);

  await anonymous.dispose();
  await owner.dispose();
});

test("a resume upload puts the current employer on the skip list, and companies add and remove", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  const upload = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
      },
    },
  });

  expect(upload.status()).toBe(201);

  const afterUpload = skipCompaniesSchema.parse(
    await (await owner.get("/api/profile/skip-companies")).json(),
  );

  expect(afterUpload.companies).toHaveLength(1);
  expect(afterUpload.companies.at(0)?.name).toBe("Brightwave Analytics");
  expect(afterUpload.companies.at(0)?.reason).toBe("current_employer");

  const added = skipCompaniesSchema.parse(
    await (
      await owner.put("/api/profile/skip-companies", {
        data: {
          companies: [
            { name: "Quillon Payments", domain: "quillon.example" },
            { name: "Brightwave Analytics", domain: null },
          ],
        },
      })
    ).json(),
  );

  expect(added.companies.map((company) => [company.name, company.reason])).toEqual([
    ["Brightwave Analytics", "current_employer"],
    ["Quillon Payments", "user"],
  ]);

  const cleared = skipCompaniesSchema.parse(
    await (await owner.put("/api/profile/skip-companies", { data: { companies: [] } })).json(),
  );

  expect(cleared.companies.map((company) => company.name)).toEqual(["Brightwave Analytics"]);

  const later = skipCompaniesSchema.parse(
    await (
      await owner.put("/api/profile/skip-companies", {
        data: { companies: [{ name: "Fenwick & Marsh", domain: null }] },
      })
    ).json(),
  );

  expect(later.companies.map((company) => company.reason)).toEqual(["current_employer", "user"]);

  const removal = skipCompaniesSchema.parse(
    await (await owner.put("/api/profile/skip-companies", { data: { companies: [] } })).json(),
  );

  expect(removal.companies.map((company) => company.name)).toEqual(["Brightwave Analytics"]);

  const invalid = await owner.put("/api/profile/skip-companies", {
    data: { companies: [{ name: "", domain: null }] },
  });

  expect(invalid.status()).toBe(400);

  await owner.dispose();
});

test("languages and the cover-letter template are saved", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  const saved = languagesSchema.parse(
    await (
      await owner.put("/api/profile/languages", { data: { languages: ["en", "fr", "de"] } })
    ).json(),
  );

  expect(saved.languages).toEqual(["en", "fr", "de"]);

  const readBack = languagesSchema.parse(await (await owner.get("/api/profile/languages")).json());

  expect(readBack.languages).toEqual(["en", "fr", "de"]);

  const settings = profileSettingsSchema.parse(
    await (
      await owner.put("/api/profile/settings", {
        data: { languages: ["en", "fr", "de"], timezone: "America/Toronto" },
      })
    ).json(),
  );

  expect(settings.timezone).toBe("America/Toronto");

  const readSettings = profileSettingsSchema.parse(
    await (await owner.get("/api/profile/settings")).json(),
  );

  expect(readSettings.timezone).toBe("America/Toronto");
  expect(readSettings.languages).toEqual(["en", "fr", "de"]);

  const badZone = await owner.put("/api/profile/settings", {
    data: { languages: ["en"], timezone: "Eastern Time (Toronto)" },
  });

  expect(badZone.status()).toBe(400);

  const template =
    "Dear {{company}},\n\nI am applying for {{role}} because {{reason}}.\n\nSincerely,\nMaya";

  const facts = factsSchema.parse(
    await (
      await owner.put("/api/profile/facts", {
        data: { facts: [{ key: "cover_letter_template", value: template }] },
      })
    ).json(),
  );

  const savedTemplate = facts.facts.find((fact) => fact.key === "cover_letter_template");

  expect(savedTemplate?.value).toBe(template);
  expect(savedTemplate?.source).toBe("user");
  expect(savedTemplate?.confirmed).toBe(true);

  const listed = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());

  expect(listed.facts.find((fact) => fact.key === "cover_letter_template")?.value).toBe(template);

  const invalid = await owner.put("/api/profile/languages", {
    data: { languages: ["English"] },
  });

  expect(invalid.status()).toBe(400);

  await owner.dispose();
});

test("a malformed facts save is a 400, not a 500", async ({ isolatedAppServer: { url } }) => {
  const owner = await ownerContextFor(url);
  const anonymous = await apiRequest.newContext({ baseURL: url });

  const anonymousMalformed = await anonymous.put("/api/profile/facts", {
    data: { facts: "not-an-array" },
  });

  expect(anonymousMalformed.status()).toBe(401);

  await anonymous.dispose();

  const nonJson = await owner.put("/api/profile/facts", {
    data: "{not-json",
    headers: { "content-type": "application/json" },
  });

  expect(nonJson.status()).toBe(400);

  const tooManyFacts = await owner.put("/api/profile/facts", {
    data: {
      facts: Array.from({ length: 65 }, (_, index) => ({ key: `fact_${index}`, value: "x" })),
    },
  });

  expect(tooManyFacts.status()).toBe(400);

  const invalidScope = await owner.put("/api/profile/facts", {
    data: { facts: [{ key: "work_auth", scope: "Canada", value: "yes" }] },
  });

  expect(invalidScope.status()).toBe(400);

  const valid = await owner.put("/api/profile/facts", {
    data: { facts: [{ key: "legal_name", value: "Maya Okafor" }] },
  });

  expect(valid.status()).toBe(200);

  await owner.dispose();
});
