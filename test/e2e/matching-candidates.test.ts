import { expect, test } from "./app.fixture.ts";
import {
  clearCatalog,
  clockNow,
  configureMatching,
  homeFor,
  idsOf,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

const createdSchema = z.object({ id: z.string() });

async function catalog(request: APIRequestContext, name: string, domain: string | null) {
  const companyId = await seedCompany(request, name, domain);

  const boardId = await seedBoard(
    request,
    companyId,
    "greenhouse",
    name.toLowerCase().replaceAll(" ", "-"),
  );

  return { boardId, companyId };
}

test("targets and languages keep only postings that fit", async ({
  isolatedAppServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);
  await clearCatalog(owner);
  const { boardId, companyId } = await catalog(owner, "Target Guild", "target-guild.example");

  const good = await seedPosting(owner, {
    atsJobId: "good",
    boardId,
    companyId,
    url: "https://target-guild.example/good",
  });

  await seedPosting(owner, {
    atsJobId: "mid",
    boardId,
    companyId,
    tags: [
      { dimension: "subrole", value: "Backend" },
      { dimension: "seniority", value: "mid" },
    ],
    title: "Mid Backend Engineer",
    url: "https://target-guild.example/mid",
  });

  await seedPosting(owner, {
    atsJobId: "french",
    boardId,
    companyId,
    language: "fr",
    title: "Backend Engineer",
    url: "https://target-guild.example/fr",
  });

  await seedPosting(owner, {
    atsJobId: "frontend",
    boardId,
    companyId,
    tags: [
      { dimension: "subrole", value: "Frontend" },
      { dimension: "seniority", value: "senior" },
    ],
    title: "Frontend Engineer",
    url: "https://target-guild.example/frontend",
  });

  await seedPosting(owner, {
    atsJobId: "contract",
    boardId,
    companyId,
    employmentType: "contract",
    title: "Contract Backend Engineer",
    url: "https://target-guild.example/contract",
  });

  await configureMatching(owner);

  const ids = idsOf(await homeFor(owner));

  expect(ids).toContain(good);
  expect(ids).toHaveLength(1);

  await owner.dispose();
});

test("remote postings match their country, or work authorisation when none is named", async ({
  isolatedAppServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);
  await clearCatalog(owner);
  const { boardId, companyId } = await catalog(owner, "Remote Guild", "remote-guild.example");

  const canada = await seedPosting(owner, {
    atsJobId: "canada",
    boardId,
    companyId,
    url: "https://remote-guild.example/canada",
  });

  await seedPosting(owner, {
    atsJobId: "usa",
    boardId,
    companyId,
    countryCode: "US",
    locationRaw: "Remote, United States",
    url: "https://remote-guild.example/usa",
  });

  await seedPosting(owner, {
    atsJobId: "eu",
    boardId,
    companyId,
    countryCode: null,
    locationRaw: "Remote, EU",
    url: "https://remote-guild.example/eu",
  });

  const anywhere = await seedPosting(owner, {
    atsJobId: "anywhere",
    boardId,
    companyId,
    countryCode: null,
    locationRaw: "Remote",
    url: "https://remote-guild.example/anywhere",
  });

  await configureMatching(owner);

  const idsBefore = idsOf(await homeFor(owner));

  expect(idsBefore).toEqual([canada]);

  await owner.put("/api/profile/facts", { data: { facts: [{ key: "work_auth", value: "Yes" }] } });

  expect(idsOf(await homeFor(owner)).toSorted()).toEqual([anywhere, canada].toSorted());

  await owner.dispose();
});

test("a salary in another currency is compared with the day's recorded rate", async ({
  isolatedAppServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);
  await clearCatalog(owner);
  const { boardId, companyId } = await catalog(owner, "Salary Guild", "salary-guild.example");

  const aboveInEuros = await seedPosting(owner, {
    atsJobId: "eur-above",
    boardId,
    companyId,
    salaryCurrency: "EUR",
    salaryMinMinor: 9_000_000,
    salaryPeriod: "year",
    title: "Senior Backend Engineer",
    url: "https://salary-guild.example/eur-above",
  });

  await seedPosting(owner, {
    atsJobId: "eur-below",
    boardId,
    companyId,
    salaryCurrency: "EUR",
    salaryMinMinor: 6_000_000,
    salaryPeriod: "year",
    title: "Backend Engineer",
    url: "https://salary-guild.example/eur-below",
  });

  await seedPosting(owner, {
    atsJobId: "usd-below",
    boardId,
    companyId,
    salaryCurrency: "USD",
    salaryMinMinor: 7_000_000,
    salaryPeriod: "year",
    title: "Platform Backend Engineer",
    url: "https://salary-guild.example/usd-below",
  });

  const noSalary = await seedPosting(owner, {
    atsJobId: "no-salary",
    boardId,
    companyId,
    salaryCurrency: null,
    salaryMinMinor: null,
    title: "Backend Engineer II",
    url: "https://salary-guild.example/no-salary",
  });

  await configureMatching(owner);

  expect(idsOf(await homeFor(owner)).toSorted()).toEqual([aboveInEuros, noSalary].toSorted());

  const day = new Date(await clockNow(owner)).toISOString().slice(0, 10);

  await owner.post("/__test__/fx-rates", {
    data: { currency: "EUR", date: day, perUsd: 2 },
  });

  expect(idsOf(await homeFor(owner))).toEqual([noSalary]);

  await owner.dispose();
});

test("the skip list also skips near-match names and domains", async ({
  isolatedAppServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);
  await clearCatalog(owner);

  const allowed = await catalog(owner, "Acme Widgets", "acme.example");
  const nearName = await catalog(owner, "Northwind Lab", "northwind-lab.example");
  const exactName = await catalog(owner, "Northwind Labs Inc", "northwind-labs.example");
  const nearDomain = await catalog(owner, "Quillon Payments", "quillon.examples");

  const allowedPosting = await seedPosting(owner, {
    atsJobId: "allowed",
    boardId: allowed.boardId,
    companyId: allowed.companyId,
    url: "https://acme.example/allowed",
  });

  const nearNamePosting = await seedPosting(owner, {
    atsJobId: "near-name",
    boardId: nearName.boardId,
    companyId: nearName.companyId,
    url: "https://northwind-lab.example/near-name",
  });

  const exactNamePosting = await seedPosting(owner, {
    atsJobId: "exact-name",
    boardId: exactName.boardId,
    companyId: exactName.companyId,
    url: "https://northwind-labs.example/exact-name",
  });

  const nearDomainPosting = await seedPosting(owner, {
    atsJobId: "near-domain",
    boardId: nearDomain.boardId,
    companyId: nearDomain.companyId,
    url: "https://quillon.examples/near-domain",
  });

  await configureMatching(owner);

  await owner.put("/api/profile/skip-companies", {
    data: {
      companies: [
        { domain: "northwind.example", name: "Northwind Labs" },
        { domain: "quillon.example", name: "A Separate Company" },
      ],
    },
  });

  const ids = idsOf(await homeFor(owner));

  expect(ids).toEqual([allowedPosting]);
  expect(ids).not.toContain(nearNamePosting);
  expect(ids).not.toContain(exactNamePosting);
  expect(ids).not.toContain(nearDomainPosting);

  await owner.dispose();
});

test("one open application per company, and none for thirty days after a send", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  await clearCatalog(owner);
  const now = await clockNow(owner);

  const alpha = await catalog(owner, "Alpha Systems", "alpha.example");
  const beta = await catalog(owner, "Beta Systems", "beta.example");
  const gamma = await catalog(owner, "Gamma Systems", "gamma.example");
  const delta = await catalog(owner, "Delta Systems", "delta.example");
  const epsilon = await catalog(owner, "Epsilon Systems", "epsilon.example");

  const allowed = await seedPosting(owner, {
    atsJobId: "alpha-1",
    boardId: alpha.boardId,
    companyId: alpha.companyId,
    url: "https://alpha.example/1",
  });

  const betaCandidate = await seedPosting(owner, {
    atsJobId: "beta-1",
    boardId: beta.boardId,
    companyId: beta.companyId,
    title: "Backend Engineer II",
    url: "https://beta.example/1",
  });

  const betaOther = await seedPosting(owner, {
    atsJobId: "beta-2",
    boardId: beta.boardId,
    companyId: beta.companyId,
    title: "Platform Backend Engineer",
    url: "https://beta.example/2",
  });

  const gammaCandidate = await seedPosting(owner, {
    atsJobId: "gamma-1",
    boardId: gamma.boardId,
    companyId: gamma.companyId,
    title: "Staff Backend Engineer",
    url: "https://gamma.example/1",
  });

  const gammaOther = await seedPosting(owner, {
    atsJobId: "gamma-2",
    boardId: gamma.boardId,
    companyId: gamma.companyId,
    title: "Data Backend Engineer",
    url: "https://gamma.example/2",
  });

  const deltaCandidate = await seedPosting(owner, {
    atsJobId: "delta-1",
    boardId: delta.boardId,
    companyId: delta.companyId,
    title: "Principal Backend Engineer",
    url: "https://delta.example/1",
  });

  const deltaOther = await seedPosting(owner, {
    atsJobId: "delta-2",
    boardId: delta.boardId,
    companyId: delta.companyId,
    title: "Senior Platform Engineer",
    url: "https://delta.example/2",
  });

  const epsilonCandidate = await seedPosting(owner, {
    atsJobId: "epsilon-1",
    boardId: epsilon.boardId,
    companyId: epsilon.companyId,
    title: "Lead Backend Engineer",
    url: "https://epsilon.example/1",
  });

  const epsilonOther = await seedPosting(owner, {
    atsJobId: "epsilon-2",
    boardId: epsilon.boardId,
    companyId: epsilon.companyId,
    title: "Staff Platform Engineer",
    url: "https://epsilon.example/2",
  });

  await seedApplication(owner, { postingId: betaOther, status: "preparing", userId });
  await seedApplication(owner, {
    postingId: gammaOther,
    sentAt: now - 3 * 86_400_000,
    status: "sent",
    userId,
  });
  await seedApplication(owner, {
    postingId: deltaOther,
    sentAt: now - 10 * 86_400_000,
    status: "sent",
    userId,
  });
  await seedApplication(owner, {
    postingId: epsilonOther,
    sentAt: now - 40 * 86_400_000,
    status: "sent",
    userId,
  });

  await configureMatching(owner);

  const ids = idsOf(await homeFor(owner));

  expect(ids).toContain(allowed);
  expect(ids).toContain(epsilonCandidate);
  expect(ids).not.toContain(betaCandidate);
  expect(ids).not.toContain(gammaCandidate);
  expect(ids).not.toContain(deltaCandidate);

  await owner.dispose();
});

test("a reposted role is skipped for sixty days after a send", async ({
  isolatedAppServer: { url },
}) => {
  const { owner, userId } = await ownerContextFor(url);
  await clearCatalog(owner);
  const now = await clockNow(owner);

  const echo = await catalog(owner, "Echo Labs", "echo.example");
  const foxtrot = await catalog(owner, "Foxtrot Labs", "foxtrot.example");

  const echoOriginal = await seedPosting(owner, {
    atsJobId: "echo-1",
    boardId: echo.boardId,
    city: "Toronto",
    companyId: echo.companyId,
    countryCode: "CA",
    title: "Backend Engineer",
    url: "https://echo.example/1",
  });

  await seedPosting(owner, {
    atsJobId: "echo-2",
    boardId: echo.boardId,
    city: "Toronto",
    companyId: echo.companyId,
    countryCode: "CA",
    title: "Backend Engineer",
    url: "https://echo.example/2",
  });

  const foxtrotOriginal = await seedPosting(owner, {
    atsJobId: "foxtrot-1",
    boardId: foxtrot.boardId,
    city: "Toronto",
    companyId: foxtrot.companyId,
    countryCode: "CA",
    title: "Backend Engineer",
    url: "https://foxtrot.example/1",
  });

  const foxtrotRepost = await seedPosting(owner, {
    atsJobId: "foxtrot-2",
    boardId: foxtrot.boardId,
    city: "Toronto",
    companyId: foxtrot.companyId,
    countryCode: "CA",
    title: "Backend Engineer",
    url: "https://foxtrot.example/2",
  });

  await seedApplication(owner, {
    postingId: echoOriginal,
    sentAt: now - 20 * 86_400_000,
    status: "sent",
    userId,
  });
  await seedApplication(owner, {
    postingId: foxtrotOriginal,
    sentAt: now - 70 * 86_400_000,
    status: "sent",
    userId,
  });

  await configureMatching(owner);

  const ids = idsOf(await homeFor(owner));

  expect(ids).toContain(foxtrotRepost);
  expect(ids).not.toContain(echoOriginal);

  await owner.dispose();
});

test("crowd limits stop a posting and an employer that have had too many applications", async ({
  isolatedAppServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);
  await clearCatalog(owner);
  const now = await clockNow(owner);

  const crowd = await catalog(owner, "Crowd Systems", "crowd.example");
  const calm = await catalog(owner, "Calm Systems", "calm.example");

  const crowded = await seedPosting(owner, {
    atsJobId: "crowded",
    boardId: crowd.boardId,
    companyId: crowd.companyId,
    url: "https://crowd.example/1",
  });

  const crowdedOther = await seedPosting(owner, {
    atsJobId: "crowded-other",
    boardId: crowd.boardId,
    companyId: crowd.companyId,
    title: "Backend Engineer II",
    url: "https://crowd.example/2",
  });

  const allowed = await seedPosting(owner, {
    atsJobId: "calm",
    boardId: calm.boardId,
    companyId: calm.companyId,
    title: "Staff Backend Engineer",
    url: "https://calm.example/1",
  });

  const otherUser = await owner.post("/__test__/users", {
    data: { email: "other@example.com", name: "Other Person" },
  });

  const otherBody: unknown = await otherUser.json();
  const otherUserId = createdSchema.parse(otherBody).id;

  await seedApplication(owner, {
    postingId: crowded,
    sentAt: now - 86_400_000,
    status: "sent",
    userId: otherUserId,
  });

  await owner.put("/__test__/settings/limits.crowd_per_posting", { data: { value: "1" } });
  await owner.put("/__test__/settings/limits.company_cooldown_days", { data: { value: "0" } });

  await configureMatching(owner);

  const postingCrowded = idsOf(await homeFor(owner));

  expect(postingCrowded).toContain(allowed);
  expect(postingCrowded).not.toContain(crowded);

  await seedApplication(owner, {
    postingId: crowdedOther,
    sentAt: now - 86_400_000,
    status: "sent",
    userId: otherUserId,
  });

  await owner.put("/__test__/settings/limits.crowd_per_posting", { data: { value: "20" } });
  await owner.put("/__test__/settings/limits.crowd_per_employer_week", { data: { value: "1" } });

  expect(idsOf(await homeFor(owner))).toEqual([allowed]);

  await owner.dispose();
});

test("a hidden posting leaves Up next, and a saved one stays with its mark", async ({
  isolatedAppServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);
  await clearCatalog(owner);
  const { boardId, companyId } = await catalog(owner, "State Systems", "state.example");

  const hidden = await seedPosting(owner, {
    atsJobId: "hidden",
    boardId,
    companyId,
    url: "https://state.example/hidden",
  });

  const saved = await seedPosting(owner, {
    atsJobId: "saved",
    boardId,
    companyId,
    title: "Staff Backend Engineer",
    url: "https://state.example/saved",
  });

  await configureMatching(owner);

  await owner.put(`/api/postings/${hidden}/state`, { data: { state: "hidden" } });
  await owner.put(`/api/postings/${saved}/state`, { data: { state: "saved" } });

  const home = await homeFor(owner);

  expect(idsOf(home)).toEqual([saved]);
  expect(home.upNext.find((candidate) => candidate.id === saved)?.saved).toBe(true);

  await owner.put(`/api/postings/${saved}/state`, { data: { state: null } });

  expect((await homeFor(owner)).upNext.find((candidate) => candidate.id === saved)?.saved).toBe(
    false,
  );

  await owner.dispose();
});

test("kill switches stop matching globally, per ATS and per employer", async ({
  isolatedAppServer: { url },
}) => {
  const { owner } = await ownerContextFor(url);
  await clearCatalog(owner);

  const greenhouse = await catalog(owner, "Switch One", "switch-one.example");
  const lever = await catalog(owner, "Switch Two", "switch-two.example");
  const leverBoardId = await seedBoard(owner, lever.companyId, "lever", "switch-two");

  const greenhousePosting = await seedPosting(owner, {
    atsJobId: "greenhouse",
    boardId: greenhouse.boardId,
    companyId: greenhouse.companyId,
    url: "https://switch-one.example/1",
  });

  const leverPosting = await seedPosting(owner, {
    ats: "lever",
    atsJobId: "lever",
    boardId: leverBoardId,
    companyId: lever.companyId,
    title: "Backend Engineer II",
    url: "https://switch-two.example/1",
  });

  await configureMatching(owner);

  const seededIds = [greenhousePosting, leverPosting];
  const idsBefore = idsOf(await homeFor(owner));

  expect(idsBefore).toEqual(expect.arrayContaining(seededIds));

  await owner.put("/__test__/kill-switches/ats/greenhouse", {
    data: { enabled: true, reason: "test" },
  });

  expect(idsOf(await homeFor(owner))).toEqual([leverPosting]);

  await owner.put("/__test__/kill-switches/ats/greenhouse", {
    data: { enabled: false, reason: "test" },
  });
  await owner.put(`/__test__/kill-switches/employer/${greenhouse.companyId}`, {
    data: { enabled: true, reason: "test" },
  });

  expect(idsOf(await homeFor(owner))).toEqual([leverPosting]);

  await owner.put(`/__test__/kill-switches/employer/${greenhouse.companyId}`, {
    data: { enabled: false, reason: "test" },
  });
  await owner.put("/__test__/kill-switches/global/all", {
    data: { enabled: true, reason: "test" },
  });

  const idsAfterGlobal = idsOf(await homeFor(owner));

  expect(idsAfterGlobal).toEqual([]);

  await owner.dispose();
});
