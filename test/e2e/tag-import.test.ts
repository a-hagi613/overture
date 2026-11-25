import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { CatalogHarness } from "./catalog-harness.ts";

type PostingTagRow = z.infer<typeof postingTagRowSchema>;

const importResponseSchema = z.object({
  id: z.string(),
  source: z.string(),
  fileSha256: z.string(),
  rows: z.number(),
  matched: z.number(),
  unmatched: z.number(),
  appliedAt: z.number(),
});

const tagImportsResponseSchema = z.object({
  tagImports: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      fileSha256: z.string(),
      rows: z.number(),
      matched: z.number(),
      uploadedBy: z.string(),
      appliedAt: z.number(),
    }),
  ),
});

const postingTagRowSchema = z.object({
  postingId: z.string(),
  dimension: z.string(),
  value: z.string(),
  source: z.string(),
});

const postingTagsResponseSchema = z.object({ postingTags: z.array(postingTagRowSchema) });

interface AddedJob {
  id: string;
  title: string;
  updatedAt: string;
  firstPublished: string;
  absoluteUrl: string;
  locationName: string;
}

function addedJob(id: string, title: string) {
  return {
    id,
    title,
    updatedAt: "2026-11-20T10:00:00.000Z",
    firstPublished: "2026-11-20T10:00:00.000Z",
    absoluteUrl: `https://boards.example/tagco/jobs/${id}?gh_jid=${id}`,
    locationName: "Toronto, Ontario, Canada",
  } satisfies AddedJob;
}

async function tagRowsFor(harness: CatalogHarness, postingId: string) {
  const response = await fetch(`${harness.app.url}/__test__/catalog/posting-tags`);

  return postingTagsResponseSchema
    .parse(await response.json())
    .postingTags.filter((row: PostingTagRow) => row.postingId === postingId);
}

async function postingByTitle(harness: CatalogHarness, title: string) {
  const postings = await harness.postings();

  for (const posting of postings) {
    if (posting.title === title) {
      return posting;
    }
  }

  return null;
}

async function importTags(harness: CatalogHarness, content: string) {
  const response = await fetch(`${harness.app.url}/__test__/tag-imports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });

  expect(response.ok).toBe(true);

  return importResponseSchema.parse(await response.json());
}

test("a tag import applies to matched Postings, wins over the AI label and is recorded", async () => {
  const boardToken = "tagimport-c";
  const harness = await startCatalogHarness([boardToken]);

  try {
    harness.fixture.mutateBoard("greenhouse", boardToken, {
      addJobs: [addedJob("7401", "Full Stack Developer")],
    });

    await harness.runBackfillCycle();

    const posting = await postingByTitle(harness, "Full Stack Developer");

    if (posting === null) {
      throw new Error("the posting was not ingested");
    }

    const labelRows = await tagRowsFor(harness, posting.id);
    const labelRole = labelRows.find((row) => row.dimension === "granular_role");

    expect(labelRows.find((row) => row.dimension === "role")?.value).toBe("software-it");
    expect(labelRole?.value).toBe("sw.fullstack");
    expect(labelRole?.source).toBe("llm");

    const content = [
      JSON.stringify({
        apply_url: `https://boards.example/tagco/jobs/7401?gh_jid=7401`,
        title: "Full Stack Developer",
        company: "Fixture Dynamics",
        role: "Software Engineering",
        subrole: "Backend",
        seniority: "senior",
      }),
      JSON.stringify({
        apply_url: "https://boards.example/nowhere/jobs/9999",
        title: "Ghost Role",
        company: "Nobody",
        role: "Sales",
      }),
    ].join("\n");

    const report = await importTags(harness, content);

    expect(report.rows).toBe(2);
    expect(report.matched).toBe(1);
    expect(report.unmatched).toBe(1);
    expect(report.source).toBe("hiring.cafe");

    const taggedPosting = await postingByTitle(harness, "Full Stack Developer");

    if (taggedPosting === null) {
      throw new Error("the posting disappeared after the import");
    }

    expect(taggedPosting.tagSource).toBe("import");

    const rows = await tagRowsFor(harness, posting.id);

    expect(rows.map((row) => `${row.dimension}=${row.value}:${row.source}`).toSorted()).toEqual([
      "granular_role=sw.backend:import",
      "role=software-it:import",
      "seniority=senior:import",
      "subrole=software-it/software-engineering:import",
    ]);

    const importsResponse = await fetch(`${harness.app.url}/__test__/tag-imports`);
    const imports = tagImportsResponseSchema.parse(await importsResponse.json());

    expect(imports.tagImports.length).toBe(1);

    const [recorded] = imports.tagImports;

    expect(recorded?.id).toBe(report.id);
    expect(recorded?.fileSha256).toBe(report.fileSha256);
    expect(recorded?.rows).toBe(2);
    expect(recorded?.matched).toBe(1);
    expect(recorded?.uploadedBy).toBe("owner");
    expect(recorded?.appliedAt).toBe(report.appliedAt);
    expect(recorded?.source).toBe("hiring.cafe");
  } finally {
    await harness.close();
  }
});
