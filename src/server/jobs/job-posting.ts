import { gunzipSync } from "node:zlib";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { BoardRegion } from "../catalog/board-feed.ts";
import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Ats } from "../../shared/ats.ts";
import type { SalaryPeriod } from "../../shared/tag-taxonomy.ts";

import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { jobs } from "../platform/db/schema.ts";

const POSTING_CHUNK = 400;

const WORKPLACES = ["remote", "hybrid", "onsite"] as const;

export type JobPostingWorkplace = (typeof WORKPLACES)[number];

/**
 * One posting resolved for a downstream consumer after matching, in the shape those consumers already expect.
 * A freehire job lives in `app.sqlite` and its description is plain UTF-8; a legacy catalog posting lives in
 * `catalog.sqlite` and its description is gzipped. Both arrive here as plain text, so callers never branch.
 */
export interface JobPosting {
  /** Where the row was found, so a writeback can target the right database. */
  origin: "jobs" | "catalog";
  postingId: string;
  ats: Ats;
  atsJobId: string;
  boardToken: string;
  /** `eu` only when the apply/url link names Lever's EU host; `null` means the board's default (US). */
  boardRegion: BoardRegion | null;
  companyId: string;
  companyName: string;
  companyNameNorm: string;
  companyDomain: string | null;
  title: string;
  /** Plain UTF-8 text: the job's own description, or the catalog posting's gunzipped description. */
  description: string;
  descriptionHash: string | null;
  url: string | null;
  applyUrl: string | null;
  locationRaw: string | null;
  workplace: JobPostingWorkplace | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  language: string | null;
  employmentType: string | null;
  salaryMinMinor: number | null;
  salaryMaxMinor: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  postedAt: number | null;
  /** The catalog's own fetch marker; freehire jobs keep it on `null` because no catalog row exists to hold it. */
  questionsFetchedAt: number | null;
  closedAt: number | null;
  /** A job is open only while its row says `open` and carries no close timestamp. */
  open: boolean;
}

export interface JobPostingDeps {
  db: AppDatabase;
  /** Optional so a read-only report can resolve freehire jobs without a catalog connection. */
  catalogDb?: CatalogDatabase | undefined;
}

const stringArraySchema = z.array(z.string());

function parseStringArray(value: string | null) {
  if (value === null) {
    return [];
  }

  try {
    const parsed = stringArraySchema.safeParse(JSON.parse(value));

    return parsed.success ? parsed.data.filter((entry) => entry.trim() !== "") : [];
  } catch {
    return [];
  }
}

function firstString(value: string | null) {
  return parseStringArray(value).at(0) ?? null;
}

function firstCountryCode(countries: string) {
  const [first] = parseStringArray(countries);

  return first !== undefined && /^[a-z]{2}$/iu.test(first) ? first.toUpperCase() : null;
}

function boardRegionOf(...urls: (string | null)[]) {
  for (const url of urls) {
    if (url === null || url === "") {
      continue;
    }

    try {
      const { hostname } = new URL(url);

      if (hostname === "jobs.eu.lever.co" || hostname === "api.eu.lever.co") {
        return "eu" satisfies BoardRegion;
      }
    } catch {
      if (url.includes("eu.lever.co")) {
        return "eu" satisfies BoardRegion;
      }
    }
  }

  return null;
}

function descriptionOf(descriptionGz: Buffer | null) {
  if (descriptionGz === null) {
    return "";
  }

  try {
    return gunzipSync(descriptionGz).toString("utf8");
  } catch {
    return "";
  }
}

function minorOf(amount: number | null) {
  return amount === null ? null : Math.round(amount * 100);
}

function salaryPeriodOf(value: string | null) {
  return value === "year" ||
    value === "month" ||
    value === "week" ||
    value === "day" ||
    value === "hour"
    ? value
    : null;
}

function workplaceOf(value: string | null) {
  return value === "remote" || value === "hybrid" || value === "onsite" ? value : null;
}

function fromJob(row: typeof jobs.$inferSelect) {
  const boardRegion = boardRegionOf(row.applyUrl, row.url);

  return {
    applyUrl: row.applyUrl,
    ats: row.source,
    atsJobId: row.atsJobId,
    boardRegion,
    boardToken: row.boardToken,
    city: firstString(row.cities),
    closedAt: row.closedAt,
    companyDomain: null,
    companyId: row.companySlug ?? row.companyNorm,
    companyName: row.company,
    companyNameNorm: row.companyNorm,
    countryCode: firstCountryCode(row.countries),
    description: row.description ?? "",
    descriptionHash: row.descriptionHash,
    employmentType: row.employmentType,
    language: row.language,
    locationRaw: row.locationRaw,
    open: row.status === "open" && row.closedAt === null,
    origin: "jobs",
    postedAt: row.postedAt,
    postingId: row.id,
    questionsFetchedAt: null,
    region: firstString(row.regions),
    salaryCurrency: row.salaryCurrency,
    salaryMaxMinor: minorOf(row.salaryMax),
    salaryMinMinor: minorOf(row.salaryMin),
    salaryPeriod: salaryPeriodOf(row.salaryPeriod),
    title: row.title,
    url: row.url,
    workplace: workplaceOf(row.workMode),
  } satisfies JobPosting;
}

function fromCatalog(row: {
  applyUrl: string | null;
  ats: Ats;
  atsJobId: string;
  boardRegion: BoardRegion;
  boardToken: string;
  city: string | null;
  closedAt: number | null;
  companyDomain: string | null;
  companyId: string;
  companyName: string;
  companyNameNorm: string;
  countryCode: string | null;
  descriptionGz: Buffer | null;
  descriptionHash: string | null;
  employmentType: string | null;
  language: string | null;
  locationRaw: string | null;
  postedAt: number | null;
  postingId: string;
  questionsFetchedAt: number | null;
  region: string | null;
  salaryCurrency: string | null;
  salaryMaxMinor: number | null;
  salaryMinMinor: number | null;
  salaryPeriod: SalaryPeriod | null;
  status: "open" | "closed";
  title: string;
  url: string;
  workplace: "remote" | "hybrid" | "onsite" | "unknown";
}) {
  return {
    applyUrl: row.applyUrl,
    ats: row.ats,
    atsJobId: row.atsJobId,
    boardRegion: row.boardRegion,
    boardToken: row.boardToken,
    city: row.city,
    closedAt: row.closedAt,
    companyDomain: row.companyDomain,
    companyId: row.companyId,
    companyName: row.companyName,
    companyNameNorm: row.companyNameNorm,
    countryCode: row.countryCode,
    description: descriptionOf(row.descriptionGz),
    descriptionHash: row.descriptionHash,
    employmentType: row.employmentType,
    language: row.language,
    locationRaw: row.locationRaw,
    open: row.status === "open" && row.closedAt === null,
    origin: "catalog",
    postedAt: row.postedAt,
    postingId: row.postingId,
    questionsFetchedAt: row.questionsFetchedAt,
    region: row.region,
    salaryCurrency: row.salaryCurrency,
    salaryMaxMinor: row.salaryMaxMinor,
    salaryMinMinor: row.salaryMinMinor,
    salaryPeriod: row.salaryPeriod,
    title: row.title,
    url: row.url,
    workplace: row.workplace === "unknown" ? null : row.workplace,
  } satisfies JobPosting;
}

function jobRows(deps: JobPostingDeps, ids: readonly string[]) {
  return deps.db
    .select()
    .from(jobs)
    .where(inArray(jobs.id, [...ids]))
    .all();
}

function catalogRows(deps: JobPostingDeps, ids: readonly string[]) {
  if (deps.catalogDb === undefined) {
    return [];
  }

  return deps.catalogDb
    .select({
      applyUrl: postings.applyUrl,
      ats: postings.ats,
      atsJobId: postings.atsJobId,
      boardRegion: companyBoards.region,
      boardToken: companyBoards.boardToken,
      city: postings.city,
      closedAt: postings.closedAt,
      companyDomain: companies.domain,
      companyId: companies.id,
      companyName: companies.name,
      companyNameNorm: companies.nameNorm,
      countryCode: postings.countryCode,
      descriptionGz: postings.descriptionGz,
      descriptionHash: postings.descriptionHash,
      employmentType: postings.employmentType,
      language: postings.language,
      locationRaw: postings.locationRaw,
      postedAt: postings.postedAt,
      postingId: postings.id,
      questionsFetchedAt: postings.questionsFetchedAt,
      region: postings.region,
      salaryCurrency: postings.salaryCurrency,
      salaryMaxMinor: postings.salaryMaxMinor,
      salaryMinMinor: postings.salaryMinMinor,
      salaryPeriod: postings.salaryPeriod,
      status: postings.status,
      title: postings.title,
      url: postings.url,
      workplace: postings.workplace,
    })
    .from(postings)
    .innerJoin(companyBoards, eq(companyBoards.id, postings.boardId))
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(inArray(postings.id, [...ids]))
    .all();
}

/**
 * Resolves many posting ids from `app.sqlite` `jobs` first and the legacy `catalog.sqlite` postings second. A job id
 * that exists in both keeps the freehire row, which is the live one after the #700 cutover.
 *
 * @param deps The application database and the optional catalog fallback.
 * @param ids The posting ids to resolve, in any order.
 * @returns Every resolved posting keyed by its id; ids absent from both tables are omitted.
 */
export function jobPostingsById(deps: JobPostingDeps, ids: readonly string[]) {
  const found = new Map<string, JobPosting>();
  const unique = [...new Set(ids)];

  for (let start = 0; start < unique.length; start += POSTING_CHUNK) {
    const chunk = unique.slice(start, start + POSTING_CHUNK);

    for (const row of jobRows(deps, chunk)) {
      found.set(row.id, fromJob(row));
    }

    const missing = chunk.filter((id) => !found.has(id));

    if (missing.length === 0) {
      continue;
    }

    for (const row of catalogRows(deps, missing)) {
      if (!found.has(row.postingId)) {
        found.set(row.postingId, fromCatalog(row));
      }
    }
  }

  return found;
}

/**
 * Resolves one posting id with the same jobs-first, catalog-fallback rule as {@link jobPostingsById}.
 *
 * @param deps The application database and the optional catalog fallback.
 * @param postingId The posting id to resolve.
 * @returns The posting, or undefined when neither table holds it.
 */
export function jobPostingById(deps: JobPostingDeps, postingId: string) {
  return jobPostingsById(deps, [postingId]).get(postingId);
}

/**
 * Marks a freehire job closed when liveness says it is gone. The legacy catalog row, if any, is closed by the
 * dispatcher through its best-effort catalog write, so this helper never writes the catalog itself.
 *
 * @param deps The application database.
 * @param postingId The posting to close.
 * @param now The close timestamp.
 * @returns Whether the freehire row was open and became closed.
 */
export function closeJobPosting(deps: JobPostingDeps, postingId: string, now: number) {
  const rows = deps.db
    .update(jobs)
    .set({ closedAt: now, status: "closed", updatedAt: now })
    .where(and(eq(jobs.id, postingId), eq(jobs.status, "open")))
    .returning({ id: jobs.id })
    .all();

  return rows.length > 0;
}
