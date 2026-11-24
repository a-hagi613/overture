import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  categoryFor,
  granularRoleNameFor,
  iscoFromEscoCode,
} from "../src/server/catalog/esco-mapping.ts";

/**
 * Builds the committed ESCO v1.2.1 dataset from the public ESCO API. Run it by hand when the upstream vocabulary or
 * the mapping rules change; the generated file is what the catalog ships, so a run never depends on the network.
 *
 *   bun run scripts/build-esco-dataset.ts
 *
 * The compact shape keeps the multilingual preferred labels (28 languages) and, where the upstream search endpoint
 * can answer, the alternative labels for the languages the daily pass meets most often. Level 1 and Level 2 are baked
 * so the runtime never recomputes them differently.
 *
 * The search endpoint returns HTTP 500 for some pages and times out on others ("More than one value found for field
 * 'hasSkillType'"). Those pages are enumerated without skills, which still carries all 28 preferred labels, and the
 * alternative-label pass simply skips them instead of issuing ~100 single-occupation requests.
 */
const OUTPUT = join(
  import.meta.dir,
  "..",
  "src",
  "server",
  "catalog",
  "tag-data",
  "esco-occupations.json",
);
const PAGE_SIZE = 100;

/** Languages whose alternative labels are kept; preferred labels are kept for every language ESCO publishes. */
const ALT_LANGUAGES = ["en", "de", "fr", "es", "ja", "it", "nl", "pl", "pt", "zh"] as const;

const searchSchema = z.object({
  total: z.number(),
  _embedded: z.object({
    results: z.array(
      z.object({
        uri: z.string(),
        title: z.string().nullable(),
        code: z.string().nullable(),
        preferredLabel: z.record(z.string(), z.string()).default({}),
        alternativeLabel: z.record(z.string(), z.array(z.string())).default({}),
      }),
    ),
  }),
});

type EscoResult = z.infer<typeof searchSchema>["_embedded"]["results"][number];

interface CompactOccupation {
  readonly ec: string;
  readonly u: string;
  readonly isco: string;
  c: string;
  r: string;
  readonly l: Record<string, string>;
  a: Record<string, string[]>;
}

function pageUrl(offset: number, full: boolean) {
  return `https://ec.europa.eu/esco/api/search?type=occupation&language=en&limit=${String(PAGE_SIZE)}&offset=${String(offset)}&full=${String(full)}&viewObsolete=false`;
}

async function fetchPage(offset: number, full: boolean, attempts = 3, timeoutMs = 45_000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(pageUrl(offset, full), {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        return searchSchema.parse(await response.json());
      }

      if (response.status < 500) {
        break;
      }
    } catch {
      // A timeout is retried while attempts remain; a deterministic 500 is not.
    }

    await Bun.sleep(1_000);
  }

  return null;
}

function compact(result: EscoResult): CompactOccupation | null {
  if (result.code === null || result.code.trim() === "") {
    return null;
  }

  const en = result.preferredLabel.en?.trim() ?? result.title?.trim() ?? "";

  if (en === "") {
    return null;
  }

  const isco = iscoFromEscoCode(result.code);
  const category = categoryFor({ en, isco });
  const alt: Record<string, string[]> = {};

  for (const language of ALT_LANGUAGES) {
    const labels = result.alternativeLabel[language];

    if (labels !== undefined && labels.length > 0) {
      alt[language] = [
        ...new Set(labels.map((label) => label.trim()).filter((label) => label !== "")),
      ];
    }
  }

  return {
    ec: result.code,
    u: result.uri,
    isco,
    c: category,
    r: granularRoleNameFor({ en, category }),
    l: result.preferredLabel,
    a: alt,
  };
}

const detailSchema = z.object({
  alternativeLabel: z.record(z.string(), z.array(z.string())).default({}),
});

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index] as T);
    }
  });

  await Promise.all(workers);

  return results;
}

async function fetchAltLabels(uri: string) {
  try {
    const response = await fetch(
      `https://ec.europa.eu/esco/api/resource/occupation?uri=${encodeURIComponent(uri)}&language=en`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (!response.ok) {
      return null;
    }

    return detailSchema.parse(await response.json()).alternativeLabel;
  } catch {
    return null;
  }
}

function writeDataset(byCode: Map<string, CompactOccupation>) {
  const occupations = [...byCode.values()].toSorted((left, right) =>
    left.ec.localeCompare(right.ec, "en"),
  );
  const categories = new Map<string, number>();
  const roles = new Set<string>();

  for (const occupation of occupations) {
    categories.set(occupation.c, (categories.get(occupation.c) ?? 0) + 1);
    roles.add(occupation.r);
  }

  const dataset = {
    version: "1.2.1",
    source: "https://ec.europa.eu/esco/api (ESCO occupations, retrieved 2026-11-24)",
    occupationCount: occupations.length,
    roleCount: roles.size,
    occupations,
  };

  writeFileSync(OUTPUT, `${JSON.stringify(dataset)}\n`);

  const summary = {
    output: OUTPUT,
    occupations: occupations.length,
    roles: roles.size,
    withAltLabels: occupations.filter((occupation) => Object.keys(occupation.a).length > 0).length,
    categories: Object.fromEntries([...categories].toSorted()),
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  return summary;
}

async function main() {
  const byCode = new Map<string, CompactOccupation>();
  let total = Number.POSITIVE_INFINITY;

  // Pass 1: enumerate every occupation without the skills payload. This is the reliable read, and it is written to
  // disk before the enrichment pass so a flaky upstream can never leave the repository without a dataset.
  for (let offset = 0; byCode.size < total; offset += 1) {
    const page = await fetchPage(offset, false);

    if (page === null || page._embedded.results.length === 0) {
      break;
    }

    total = page.total;

    for (const result of page._embedded.results) {
      const entry = compact(result);

      if (entry !== null && !byCode.has(entry.ec)) {
        byCode.set(entry.ec, entry);
      }
    }

    process.stderr.write(
      `esco: page ${String(offset)} (${String(byCode.size)}/${String(total)})\n`,
    );
  }

  writeDataset(byCode);

  // Pass 2: add alternative labels from each occupation's own resource endpoint. The search endpoint's full payload
  // is broken for some pages ("More than one value found for field 'hasSkillType'"), so the detail endpoint is the
  // reliable source. A failed detail read leaves the occupation with its 28 preferred labels.
  if (!process.argv.includes("--no-enrich")) {
    const occupations = [...byCode.values()];
    let done = 0;
    let enriched = 0;

    await mapWithConcurrency(occupations, 24, async (occupation) => {
      const altLabels = await fetchAltLabels(occupation.u);

      if (altLabels !== null) {
        for (const language of ALT_LANGUAGES) {
          const labels = altLabels[language];

          if (labels !== undefined && labels.length > 0) {
            occupation.a[language] = [
              ...new Set(labels.map((label) => label.trim()).filter((label) => label !== "")),
            ];
            enriched += 1;
          }
        }
      }

      done += 1;

      if (done % 500 === 0) {
        process.stderr.write(`esco: alt labels ${String(done)}/${String(occupations.length)}\n`);
      }
    });

    writeDataset(byCode);
    process.stderr.write(`esco: enriched ${String(enriched)} language label sets\n`);
  }
}

await main();
