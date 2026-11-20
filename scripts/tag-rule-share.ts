import { readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import { tagPosting } from "../src/server/catalog/tag-rules.ts";
import { postingTagInputSchema } from "../src/shared/tag-taxonomy.ts";

const sampleRowSchema = z.looseObject({
  ats: z.string(),
  title: z.string(),
  language: z.string().min(2).max(5).nullable(),
});

const decimals = (share: number) => `${(share * 100).toFixed(1)} %`;

function shareLine(label: string, count: number, total: number, extra = "") {
  return `| ${label} | ${String(count)} | ${decimals(count / total)} | ${extra} |`;
}

const lines = await readFile("test/fixtures/tagging-sample.jsonl", "utf8");

const rows = lines
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => {
    const sample = sampleRowSchema.parse(JSON.parse(line));
    const input = postingTagInputSchema.parse(sample);

    return {
      ats: sample.ats,
      tags: tagPosting(input),
      salaryStructured: input.salary !== null,
      languageFromSource: sample.language !== null,
    };
  });

const total = rows.length;

const byRules = rows.filter((row) => row.tags.roleSource === "rules").length;
const byModel = rows.filter((row) => row.tags.roleSource === "model").length;
const unclassified = rows.filter((row) => row.tags.roleSource === "unclassified").length;
const seniority = rows.filter((row) => row.tags.seniority !== null).length;
const workplaceKnown = rows.filter((row) => row.tags.workplace !== "unknown").length;
const employmentKnown = rows.filter((row) => row.tags.employmentType !== "unknown").length;
const located = rows.filter((row) => row.tags.city !== null).length;

const countryResolved = rows.filter(
  (row) => row.tags.countryCode !== null && row.tags.city === null,
).length;

const salaryFromSource = rows.filter((row) => row.salaryStructured).length;

const salaryFromPatterns = rows.filter(
  (row) => row.tags.salaryMinMinor !== null && !row.salaryStructured,
).length;

const salaryNone = rows.filter((row) => row.tags.salaryMinMinor === null).length;

const languageFromSource = rows.filter((row) => row.languageFromSource).length;

const languageDetected = rows.filter(
  (row) => !row.languageFromSource && row.tags.language !== null && row.tags.language !== "en",
).length;

const languageDefaulted = rows.filter(
  (row) => !row.languageFromSource && row.tags.language === "en",
).length;

const roleCounts = new Map<string, number>();

for (const row of rows) {
  const role = row.tags.role ?? "unclassified";
  roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
}

const topRoles = [...roleCounts.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 12);

const perAts = new Map<string, number>();

for (const row of rows) {
  perAts.set(row.ats, (perAts.get(row.ats) ?? 0) + 1);
}

const report = [
  "# Tag rule share over a recorded posting sample",
  "",
  "Recorded from real Greenhouse, Lever and Ashby boards by `scripts/pull-tagging-sample.ts`; classified with `tagPosting` in `src/server/catalog/tag-rules.ts`. Phase 1 of issue #17; run `bun run scripts/tag-rule-share.ts` to refresh.",
  "",
  "| Dimension | Classified | Share | Notes |",
  "|---|---|---|---|",
  shareLine("role by keyword rules", byRules, total),
  shareLine("role by O*NET title similarity", byModel, total, "threshold 0.85"),
  shareLine("role unclassified", unclassified, total, "goes to the LLM batch in the full pipeline"),
  shareLine("seniority tagged", seniority, total),
  shareLine("seniority not in the title", total - seniority, total),
  shareLine("workplace from field, flag or text", workplaceKnown, total),
  shareLine("workplace unclassified", total - workplaceKnown, total),
  shareLine("employment type", employmentKnown, total),
  shareLine("employment type not stated", total - employmentKnown, total),
  shareLine(
    "location to city",
    located,
    total,
    `${String(countryResolved)} resolved to country only`,
  ),
  shareLine("salary from structured fields", salaryFromSource, total),
  shareLine("salary from pay-range patterns", salaryFromPatterns, total),
  shareLine("salary not found", salaryNone, total),
  shareLine("language from the source field", languageFromSource, total),
  shareLine("language detected by trigrams", languageDetected, total, "non-English postings"),
  shareLine("language defaulted to English", languageDefaulted, total),
  "",
  "Per ATS:",
  "",
  "| Source | Postings | Share | Notes |",
  "|---|---|---|---|",
  ...[...perAts.entries()]
    .toSorted((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ats, count]) => shareLine(ats, count, total)),
  "",
  "Top roles:",
  "",
  "| Role | Postings | Share | Notes |",
  "|---|---|---|---|",
  ...topRoles.map(([role, count]) => shareLine(role, count, total)),
  "",
].join("\n");

await writeFile("docs/research/tag-rule-share.md", report);

process.stdout.write(report);
