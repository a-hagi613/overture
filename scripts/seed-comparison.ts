import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { parquetMetadata, parquetRead } from "hyparquet";
import { z } from "zod";

import { createClock } from "../src/server/platform/ports/clock.ts";
import {
  PINNED_COMPANIES_PARQUET_SHA256,
  PINNED_MANIFEST_SHA256,
} from "../src/server/catalog/companies-parquet.ts";

const MANIFEST_SHA256 = PINNED_MANIFEST_SHA256;
const COMPANIES_PARQUET_SHA256 = PINNED_COMPANIES_PARQUET_SHA256;
const USER_AGENT = "overture-catalog-seed/0.1 (comparison for a-hagi613/overture#56)";
const MILLISECONDS_PER_REQUEST = 550;
const GREENHOUSE = "greenhouse";
const LEVER = "lever";
const ASHBY = "ashby";
const WORKDAY = "workday";
const M1_ATS_NAMES = [GREENHOUSE, LEVER, ASHBY];
const STRATA_NAMES = ["v1_only", "overlap", "scrapers_only"];

interface Board {
  ats: string;
  token: string;
  company: string;
}

interface StratumResult {
  population: number;
  sampled: string[];
  checked: number;
  live: number;
  empty: number;
  gone: number;
  otherStatus: number;
  fetchError: number;
  unparsedBody: number;
  postingsTotal: number;
}

interface OverlapStats {
  v1: number;
  scrapers: number;
  overlap: number;
  v1Only: number;
  scrapersOnly: number;
  union: number;
  overlapWithCaseMismatch: number;
}

interface Estimate {
  population: number;
  liveRatePercent: number;
  liveBoards: number;
  postingsPerLiveBoard: number | null;
  postings: number;
}

const byAtsArtifactSchema = z.object({
  rows: z.number(),
  sha256: z.string(),
  size_bytes: z.number(),
});

const companiesSchema = z.object({
  csv: z.string(),
  parquet: z.string(),
  parquet_sha256: z.string(),
  parquet_size_bytes: z.number(),
  rows: z.number(),
  sha256: z.string(),
  size_bytes: z.number(),
});

const manifestSchema = z.object({
  version: z.string(),
  generated_at: z.string(),
  updated_at: z.string(),
  canonical_prefix: z.string(),
  stats: z.object({
    schema_version: z.string(),
    total_companies: z.number(),
    total_jobs: z.number(),
    total_jobs_raw: z.number(),
    ats_count: z.number(),
    ats_jobs: z.number(),
    schema_columns: z.array(z.string()),
  }),
  companies: companiesSchema,
  by_ats_companies: z.record(z.string(), byAtsArtifactSchema),
});

const clock = createClock();

const boardListingSchema = z.union([
  z.object({
    jobs: z.array(z.unknown()).optional(),
    postings: z.array(z.unknown()).optional(),
  }),
  z.array(z.unknown()),
]);

const parquetRowSchema = z.tuple([z.string(), z.string(), z.string(), z.string()]);

const args = parseArgs({
  options: {
    v1: { type: "string" },
    manifest: { type: "string" },
    companies: { type: "string" },
    live: { type: "boolean", default: false },
    "sample-size": { type: "string", default: "150" },
    out: { type: "string" },
  },
  strict: true,
});

const v1Path = args.values.v1;
const manifestPath = args.values.manifest;
const companiesPath = args.values.companies;
const outPath = args.values.out;
const sampleSizeArg = args.values["sample-size"];
const sampleSize = Math.trunc(Number(sampleSizeArg));

if (
  v1Path === undefined ||
  manifestPath === undefined ||
  companiesPath === undefined ||
  outPath === undefined ||
  Number.isNaN(sampleSize) ||
  sampleSize < 1
) {
  throw new Error(
    "usage: bun run scripts/seed-comparison.ts --v1 <csv> --manifest <manifest.json> --companies <companies.parquet> --out <report.json> [--live] [--sample-size N]",
  );
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type ProbeOutcome = "live" | "empty" | "gone" | "otherStatus" | "fetchError" | "unparsedBody";

const probe = (outcome: ProbeOutcome, postings: number) => ({ outcome, postings });

const manifestBytes = readFileSync(manifestPath);
const manifestHash = sha256(manifestBytes);

if (manifestHash !== MANIFEST_SHA256) {
  throw new Error(
    `manifest sha256 pin mismatch: pinned ${MANIFEST_SHA256}, actual ${manifestHash}. Verify the upstream change is legitimate, then re-pin both hashes in this script and rerun.`,
  );
}

const parquetBytes = readFileSync(companiesPath);
const parquetHash = sha256(parquetBytes);

if (parquetHash !== COMPANIES_PARQUET_SHA256) {
  throw new Error(
    `companies.parquet sha256 pin mismatch: pinned ${COMPANIES_PARQUET_SHA256}, actual ${parquetHash}. Verify the upstream change is legitimate, then re-pin both hashes in this script and rerun.`,
  );
}

const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));

if (manifest.companies.parquet_sha256 !== COMPANIES_PARQUET_SHA256) {
  throw new Error(
    `manifest companies.parquet_sha256 ${manifest.companies.parquet_sha256} does not match the pin ${COMPANIES_PARQUET_SHA256}`,
  );
}

const arrayBuffer = new ArrayBuffer(parquetBytes.byteLength);

new Uint8Array(arrayBuffer).set(parquetBytes);

const parquetMeta = parquetMetadata(arrayBuffer);
const expectedColumns = ["ats", "name", "slug", "url"];

const parquetColumns = parquetMeta.schema
  .map((field) => field.name)
  .filter((name) => name !== "schema");

if (parquetColumns.join(",") !== expectedColumns.join(",")) {
  throw new Error(
    `companies.parquet schema changed: columns are [${parquetColumns.join(", ")}], expected [${expectedColumns.join(", ")}]. The dataset schema moved; update the pins and mapping deliberately.`,
  );
}

if (Number(parquetMeta.num_rows) !== manifest.companies.rows) {
  throw new Error(
    `companies.parquet has ${String(parquetMeta.num_rows)} rows, manifest declares ${String(manifest.companies.rows)}`,
  );
}

const scraperRows: Board[] = [];
let parquetRowsSeen = 0;

await parquetRead({
  file: arrayBuffer,
  onComplete(rows) {
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 4) {
        throw new Error(`companies.parquet row ${String(parquetRowsSeen)} is not a 4-column array`);
      }

      const cells: unknown[] = row;
      const parsed = parquetRowSchema.safeParse(cells);

      if (!parsed.success) {
        throw new TypeError(
          `companies.parquet row ${String(parquetRowsSeen)} does not match (ats, name, slug, url) as strings`,
        );
      }

      const [ats, name, slug, _url] = parsed.data;

      parquetRowsSeen += 1;
      scraperRows.push({ ats, token: slug, company: name });
    }
  },
});

if (parquetRowsSeen !== manifest.companies.rows) {
  throw new Error(
    `companies.parquet read ${String(parquetRowsSeen)} rows, expected ${String(manifest.companies.rows)}`,
  );
}

for (const ats of M1_ATS_NAMES) {
  const declared = manifest.by_ats_companies[ats];

  if (declared === undefined) {
    throw new Error(
      `manifest by_ats_companies is missing ${ats}: the hosted dataset dropped an M1 ATS`,
    );
  }

  const found = scraperRows.filter((row) => row.ats === ats).length;

  if (found !== declared.rows) {
    throw new Error(
      `companies.parquet has ${String(found)} ${ats} rows, manifest by_ats_companies declares ${String(declared.rows)}`,
    );
  }
}

const parseCsvLine = (line: string) => {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (const character of line) {
    if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  fields.push(current);

  return fields;
};

const v1Lines = readFileSync(v1Path, "utf8")
  .split("\n")
  .filter((line) => line.length > 0);

const v1Header = parseCsvLine(v1Lines[0] ?? "");

if (v1Header.join(",") !== "ats,board_id,company,source,consecutive_not_found") {
  throw new Error(`v1 CSV header changed: [${v1Header.join(", ")}]`);
}

const v1Rows: Board[] = [];
const v1WorkdayRows: Board[] = [];

for (const line of v1Lines.slice(1)) {
  const fields = parseCsvLine(line);

  if (fields.length !== 5) {
    throw new Error(`v1 CSV line does not have 5 fields: ${line}`);
  }

  const board = { ats: fields[0] ?? "", token: fields[1] ?? "", company: fields[2] ?? "" };

  if (board.ats === WORKDAY) {
    v1WorkdayRows.push(board);
  } else {
    v1Rows.push(board);
  }
}

const tokenFromUrl = (value: string) => {
  const url = new URL(value);
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

  return segments.at(-1) ?? null;
};

const scraperBoardToken = (value: string) => {
  try {
    return tokenFromUrl(value);
  } catch {
    return value;
  }
};

const scraperSets = new Map<string, Map<string, string>>();
const scraperWorkdayRows: Board[] = [];
const scraperRowsWithoutToken = new Map<string, number>();

for (const row of scraperRows) {
  if (row.ats === WORKDAY) {
    scraperWorkdayRows.push(row);
    continue;
  }

  const token = scraperBoardToken(row.token);

  if (token === null) {
    scraperRowsWithoutToken.set(row.ats, (scraperRowsWithoutToken.get(row.ats) ?? 0) + 1);
    continue;
  }

  let boards = scraperSets.get(row.ats);

  if (boards === undefined) {
    boards = new Map();
    scraperSets.set(row.ats, boards);
  }

  if (!boards.has(token)) {
    boards.set(token, row.company);
  }
}

const v1Sets = new Map<string, Map<string, string>>();

for (const row of v1Rows) {
  let boards = v1Sets.get(row.ats);

  if (boards === undefined) {
    boards = new Map();
    v1Sets.set(row.ats, boards);
  }

  if (!boards.has(row.token)) {
    boards.set(row.token, row.company);
  }
}

const overlapByAts = new Map<string, OverlapStats>();
const populationTokens = new Map<string, string[]>();

for (const ats of M1_ATS_NAMES) {
  const v1Boards = v1Sets.get(ats);

  if (v1Boards === undefined) {
    throw new Error(`v1 seed has no ${ats} boards`);
  }

  const scraperBoards = scraperSets.get(ats);

  if (scraperBoards === undefined) {
    throw new Error(`ats-scrapers seed has no ${ats} boards`);
  }

  const overlap = new Map<string, string>();
  let overlapWithCaseMismatch = 0;

  for (const [token, company] of v1Boards) {
    if (scraperBoards.has(token)) {
      overlap.set(token, company);

      if (token !== token.toLowerCase()) {
        overlapWithCaseMismatch += 1;
      }
    }
  }

  const v1Only = new Map(v1Boards);
  const scrapersOnly = new Map(scraperBoards);

  for (const token of overlap.keys()) {
    v1Only.delete(token);
    scrapersOnly.delete(token);
  }

  overlapByAts.set(ats, {
    v1: v1Boards.size,
    scrapers: scraperBoards.size,
    overlap: overlap.size,
    v1Only: v1Only.size,
    scrapersOnly: scrapersOnly.size,
    union: new Map([...v1Boards, ...scraperBoards]).size,
    overlapWithCaseMismatch,
  });

  const sources = new Map([
    ["v1_only", [...v1Only.keys()]],
    ["overlap", [...overlap.keys()]],
    ["scrapers_only", [...scrapersOnly.keys()]],
  ]);

  for (const stratum of STRATA_NAMES) {
    const tokens = sources.get(stratum);

    if (tokens === undefined) {
      throw new Error(`unknown stratum ${stratum}`);
    }

    populationTokens.set(`${ats}:${stratum}`, tokens);
  }
}

const randomBytes = new Uint32Array(1);

const randomBelow = (bound: number) => {
  const limit = 4_294_967_296 - (4_294_967_296 % bound);
  let value = 4_294_967_296;

  while (value >= limit) {
    crypto.getRandomValues(randomBytes);
    value = randomBytes[0] ?? 4_294_967_296;
  }

  return value % bound;
};

const emptyStratumResult = (population: number) => ({
  population,
  sampled: [],
  checked: 0,
  live: 0,
  empty: 0,
  gone: 0,
  otherStatus: 0,
  fetchError: 0,
  unparsedBody: 0,
  postingsTotal: 0,
});

const sampleResults = new Map<string, StratumResult>();

for (const [key, tokens] of populationTokens) {
  if (args.values.live) {
    const take = Math.min(sampleSize, tokens.length);
    const pool = [...tokens];

    for (let index = 0; index < take; index += 1) {
      const swap = index + randomBelow(pool.length - index);
      const held = pool[index] ?? "";
      pool[index] = pool[swap] ?? "";
      pool[swap] = held;
    }

    sampleResults.set(key, { ...emptyStratumResult(tokens.length), sampled: pool.slice(0, take) });
  } else {
    sampleResults.set(key, emptyStratumResult(tokens.length));
  }
}

const encodeToken = (token: string) => {
  if (token.includes("%")) {
    return token;
  }

  return encodeURIComponent(token);
};

const boardUrl = (ats: string, token: string) => {
  if (ats === GREENHOUSE) {
    return `https://boards-api.greenhouse.io/v1/boards/${encodeToken(token)}/jobs`;
  }

  if (ats === LEVER) {
    return `https://api.lever.co/v0/postings/${encodeToken(token)}?mode=json`;
  }

  return `https://api.ashbyhq.com/posting-api/job-board/${encodeToken(token)}`;
};

let nextScheduledStart = 0;

const pacedFetch = async (index: number, ats: string, token: string) => {
  const start = Math.max(clock.now(), nextScheduledStart);
  nextScheduledStart = start + MILLISECONDS_PER_REQUEST;

  const send = async () => {
    let response: Response;

    try {
      response = await fetch(boardUrl(ats, token), {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      });
    } catch {
      return probe("fetchError", 0);
    }

    if (!response.ok) {
      return response.status === 404 || response.status === 410
        ? probe("gone", 0)
        : probe("otherStatus", 0);
    }

    try {
      const parsed = boardListingSchema.parse(JSON.parse(await response.text()));

      const postings = Array.isArray(parsed)
        ? parsed.length
        : (parsed.jobs?.length ?? 0) + (parsed.postings?.length ?? 0);

      return postings > 0 ? probe("live", postings) : probe("empty", 0);
    } catch {
      return probe("unparsedBody", 0);
    }
  };

  return new Promise((resolve) => {
    setTimeout(resolve, start - clock.now());
  }).then(send);
};

const countOutcome = (
  result: StratumResult,
  outcome: { outcome: ProbeOutcome; postings: number },
) => {
  result.checked += 1;

  if (outcome.outcome === "live") {
    result.live += 1;
    result.postingsTotal += outcome.postings;
  } else if (outcome.outcome === "empty") {
    result.empty += 1;
  } else if (outcome.outcome === "gone") {
    result.gone += 1;
  } else if (outcome.outcome === "otherStatus") {
    result.otherStatus += 1;
  } else if (outcome.outcome === "fetchError") {
    result.fetchError += 1;
  } else {
    result.unparsedBody += 1;
  }
};

if (args.values.live) {
  const scheduledProbes = [...sampleResults].flatMap(([key, result]) => {
    const ats = key.split(":")[0] ?? "";

    return result.sampled.map((token, index) => ({
      key,
      result,
      promise: pacedFetch(index, ats, token),
    }));
  });

  const settled = await Promise.all(scheduledProbes.map(async (entry) => entry.promise));

  for (const [index, outcome] of settled.entries()) {
    const entry = scheduledProbes[index];

    if (entry === undefined) {
      throw new Error(`probe result missing at index ${String(index)}`);
    }

    countOutcome(entry.result, outcome);
  }

  for (const [key, result] of sampleResults) {
    const rate = result.checked > 0 ? (result.live / result.checked) * 100 : 0;
    process.stdout.write(
      `${key}: checked ${result.checked}, live ${result.live} (${rate.toFixed(1)}%), empty ${result.empty}, gone ${result.gone}, other ${result.otherStatus + result.fetchError + result.unparsedBody}\n`,
    );
  }
}

const estimateFor = (ats: string, strata: string[]) => {
  let population = 0;
  let liveBoards = 0;
  let postings = 0;

  for (const stratum of strata) {
    const result = sampleResults.get(`${ats}:${stratum}`);

    if (result === undefined) {
      throw new Error(`sample results missing for ${ats}:${stratum}`);
    }

    population += result.population;

    if (result.checked > 0) {
      const share = result.live / result.checked;
      liveBoards += share * result.population;
      const mean = result.live > 0 ? result.postingsTotal / result.live : 0;
      postings += mean * share * result.population;
    }
  }

  const liveRatePercent = population > 0 ? (liveBoards / population) * 100 : 0;

  return {
    population,
    liveRatePercent,
    liveBoards,
    postingsPerLiveBoard: liveBoards > 0 ? postings / liveBoards : null,
    postings,
  };
};

const estimates = new Map<string, Estimate>();

for (const ats of M1_ATS_NAMES) {
  estimates.set(`v1:${ats}`, estimateFor(ats, ["v1_only", "overlap"]));
  estimates.set(`scrapers:${ats}`, estimateFor(ats, ["scrapers_only", "overlap"]));
  estimates.set(`union:${ats}`, estimateFor(ats, ["v1_only", "overlap", "scrapers_only"]));
}

const report = {
  pinned: {
    manifest_sha256: MANIFEST_SHA256,
    companies_parquet_sha256: COMPANIES_PARQUET_SHA256,
    manifest_generated_at: manifest.generated_at,
    manifest_updated_at: manifest.updated_at,
    dataset_schema_version: manifest.stats.schema_version,
  },
  inputs: {
    v1_boards: v1Lines.length - 1,
    parquet_rows: parquetRowsSeen,
    parquet_columns: parquetColumns,
    sample_size_per_stratum: sampleSize,
    live_checks_enabled: args.values.live,
  },
  counts: {
    by_ats: Object.fromEntries(overlapByAts),
    workday: {
      v1: v1WorkdayRows.length,
      scrapers: scraperWorkdayRows.length,
      note: "v1 workday tokens are tenant/wd-site/site (for example 23andme/wd5/23); ats-scrapers slugs are tenant/site (23andme/23). The formats do not join, so the overlap is not countable and no live check is run. Reported for information only.",
    },
    scraper_rows_without_board_token: Object.fromEntries(scraperRowsWithoutToken),
  },
  samples: Object.fromEntries(sampleResults),
  estimates: Object.fromEntries(estimates),
};

writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(`report written to ${outPath}\n`);
