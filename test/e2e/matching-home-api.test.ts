import { z } from "zod";

import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import {
  clearCatalog,
  configureMatching,
  grantApplications,
  homeFor,
  ownerContextFor,
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

const postingSchema = z.object({
  id: z.string(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
});

const stateSchema = z.object({ id: z.string(), state: z.enum(["saved", "hidden"]).nullable() });

async function seedUpNext(server: AppServer) {
  const { owner } = await ownerContextFor(server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const seeds = [
    { company: "Northwind Labs", title: "Senior Backend Engineer" },
    { company: "Ferro Cloud", title: "Data Backend Engineer" },
    { company: "Halden Systems", title: "Backend Engineer" },
  ];

  const ids = await Promise.all(
    seeds.map(async (seed) => {
      const slug = seed.company.toLowerCase().replaceAll(" ", "-");
      const companyId = await seedCompany(owner, seed.company, `${slug}.example`);
      const boardId = await seedBoard(owner, companyId, "greenhouse", slug);

      return seedPosting(owner, {
        atsJobId: slug,
        boardId,
        companyId,
        title: seed.title,
        url: `https://${slug}.example/1`,
      });
    }),
  );

  return { ids, owner };
}

test("/api/home carries no Up next work; the candidates have their own endpoint", async ({
  matching,
}) => {
  const { owner } = await ownerContextFor(matching.server.url);

  const home = await owner.get("/api/home");

  expect(home.ok()).toBe(true);
  expect(await home.json()).not.toHaveProperty("upNext");

  const candidates = await owner.get("/api/matching/up-next");

  expect(candidates.ok()).toBe(true);
  expect(z.object({ items: z.array(z.unknown()) }).parse(await candidates.json()).items).toEqual(
    [],
  );

  await owner.dispose();
});

test("Up next lists code-ranked candidates, and opening one sets its score and Strong match", async ({
  matching,
}) => {
  const { ids, owner } = await seedUpNext(matching.server);

  const initial = await homeFor(owner);

  expect(initial.upNext).toHaveLength(3);
  expect(initial.upNext.every((candidate) => candidate.score === null)).toBe(true);
  expect(initial.upNext.every((candidate) => !candidate.strong)).toBe(true);

  const strong = postingSchema.parse(await (await owner.get(`/api/postings/${ids[0]}`)).json());

  expect(strong.score).toBe(92);
  expect(strong.reason).toContain("Go and Postgres");

  const weak = postingSchema.parse(await (await owner.get(`/api/postings/${ids[2]}`)).json());

  expect(weak.score).toBe(55);

  const scored = await homeFor(owner);
  const strongCard = scored.upNext.find((candidate) => candidate.id === ids[0]);
  const weakCard = scored.upNext.find((candidate) => candidate.id === ids[2]);

  expect(strongCard?.score).toBe(92);
  expect(strongCard?.strong).toBe(true);
  expect(strongCard?.reason).toContain("Go and Postgres");
  expect(weakCard?.score).toBe(55);
  expect(weakCard?.strong).toBe(false);

  await owner.dispose();
});

test("Save and Hide act through the posting state API", async ({ matching }) => {
  const { ids, owner } = await seedUpNext(matching.server);

  const saved = stateSchema.parse(
    await (await owner.put(`/api/postings/${ids[0]}/state`, { data: { state: "saved" } })).json(),
  );

  expect(saved.state).toBe("saved");
  expect((await homeFor(owner)).upNext.find((candidate) => candidate.id === ids[0])?.saved).toBe(
    true,
  );

  const hidden = stateSchema.parse(
    await (await owner.put(`/api/postings/${ids[2]}/state`, { data: { state: "hidden" } })).json(),
  );

  expect(hidden.state).toBe("hidden");

  const afterHide = await homeFor(owner);

  expect(afterHide.upNext.some((candidate) => candidate.id === ids[2])).toBe(false);
  expect(afterHide.upNext).toHaveLength(2);

  await owner.put(`/api/postings/${ids[0]}/state`, { data: { state: null } });

  expect((await homeFor(owner)).upNext.find((candidate) => candidate.id === ids[0])?.saved).toBe(
    false,
  );

  await owner.dispose();
});

test("Apply creates an Application and takes the posting out of Up next", async ({ matching }) => {
  const { ids, owner } = await seedUpNext(matching.server);

  const applied = z
    .object({ applicationId: z.string(), created: z.boolean() })
    .parse(await (await owner.post(`/api/postings/${ids[0]}/apply`, { data: {} })).json());

  expect(applied.created).toBe(true);

  const afterApply = await homeFor(owner);

  expect(afterApply.upNext.some((candidate) => candidate.id === ids[0])).toBe(false);
  expect(afterApply.upNext).toHaveLength(2);

  const again = z
    .object({ applicationId: z.string(), created: z.boolean() })
    .parse(await (await owner.post(`/api/postings/${ids[0]}/apply`, { data: {} })).json());

  expect(again.created).toBe(false);
  expect(again.applicationId).toBe(applied.applicationId);

  await owner.dispose();
});
