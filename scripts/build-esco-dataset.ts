import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  categoryFor,
  granularRoleNameFor,
  iscoFromEscoCode,
} from "../src/server/catalog/esco-mapping.ts";

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

const detailSchema = z.object({
  alternativeLabel: z.record(z.string(), z.array(z.string())).default({}),
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

const attemptPage: (
  offset: number,
  full: boolean,
  attempt: number,
  attempts: number,
  timeoutMs: number,
) => Promise<z.infer<typeof searchSchema> | null> = async (
  offset,
  full,
  attempt,
  attempts,
  timeoutMs,
) => {
  if (attempt >= attempts) {
    return null;
  }

  try {
    const response = await fetch(pageUrl(offset, full), {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      return searchSchema.parse(await response.json());
    }

    if (response.status < 500) {
      return null;
    }
  } catch {
    return attemptPage(offset, full, attempt + 1, attempts, timeoutMs);
  }

  await Bun.sleep(1000);

  return attemptPage(offset, full, attempt + 1, attempts, timeoutMs);
};

async function fetchPage(offset: number, full: boolean, attempts = 3, timeoutMs = 45_000) {
  return attemptPage(offset, full, 0, attempts, timeoutMs);
}

function compact(result: EscoResult) {
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

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let next = 0;

  const runWorker: () => Promise<void> = async () => {
    const index = next;
    next += 1;

    const item = items[index];

    if (item === undefined) {
      return;
    }

    results[index] = await mapper(item);

    return runWorker();
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => await runWorker()),
  );

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
    categories: Object.fromEntries(
      [...categories].toSorted(([left], [right]) => left.localeCompare(right, "en")),
    ),
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  return summary;
}

const collectPages: (
  byCode: Map<string, CompactOccupation>,
  offset: number,
  total: number,
) => Promise<void> = async (byCode, offset, total) => {
  if (byCode.size >= total) {
    return;
  }

  const page = await fetchPage(offset, false);

  if (page === null) {
    return;
  }

  const { results } = page._embedded;

  if (results.length === 0) {
    return;
  }

  for (const result of results) {
    const entry = compact(result);

    if (entry !== null && !byCode.has(entry.ec)) {
      byCode.set(entry.ec, entry);
    }
  }

  process.stderr.write(
    `esco: page ${String(offset)} (${String(byCode.size)}/${String(page.total)})\n`,
  );

  await Bun.sleep(300);

  return collectPages(byCode, offset + 1, page.total);
};

async function main() {
  const byCode = new Map<string, CompactOccupation>();

  await collectPages(byCode, 0, Number.POSITIVE_INFINITY);

  writeDataset(byCode);

  if (process.argv.includes("--no-enrich")) {
    return;
  }

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

await main();
