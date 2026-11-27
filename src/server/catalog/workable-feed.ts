import { Parser } from "htmlparser2";
import { z } from "zod";

import {
  EMPLOYMENT_TYPES,
  SENIORITIES,
  WORKPLACES,
  postingTagsSchema,
} from "../../shared/tag-taxonomy.ts";
import { taxonomyRoleTags } from "./taxonomy-tags.ts";
import { planRoleTargets, roleMatchScore } from "../matching/role-targets.ts";
import { locationTextsOfPlaceIds } from "../places/catalog.ts";
import { resolveLocation } from "./geo.ts";
import { DESCRIPTION_CAP, htmlToText } from "./html-to-text.ts";
import { normalizeTitle } from "./normalize.ts";
import { tagPosting } from "./tag-rules.ts";

import type { PostingTags, Seniority } from "../../shared/tag-taxonomy.ts";
import type { RoleLabel } from "./taxonomy-tags.ts";

export const WORKABLE_TARGETS_KEY = "workable-targets.json";
export const WORKABLE_MANIFEST_KEY = "workable/manifest.json";

export const workableTargetsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  roles: z.array(z.string().min(1)),
  locations: z.array(z.string().min(1)),
  seniorities: z.array(z.enum(SENIORITIES)),
  workplaces: z.array(z.enum(WORKPLACES)),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
});

export type WorkableTargets = z.infer<typeof workableTargetsSchema>;

export const workableManifestSchema = z.object({
  version: z.literal(1),
  snapshot: z.string().min(1),
  fetchedAt: z.string().min(1),
  sourceLastModified: z.string().nullable(),
  feedJobs: z.number().int().nonnegative(),
  distinctReferences: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

export type WorkableManifest = z.infer<typeof workableManifestSchema>;

export const workableSnapshotRowSchema = z.object({
  version: z.literal(1),
  reference: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  url: z.string().min(1),
  applyUrl: z.string().min(1),
  postedAt: z.string().nullable(),
  locationRaw: z.string().nullable(),
  department: z.string().nullable(),
  descriptionText: z.string(),
  tags: postingTagsSchema,
});

export type WorkableSnapshotRow = z.infer<typeof workableSnapshotRowSchema>;

export const experienceSeniority = new Map<string, Seniority>([
  ["internship", "intern"],
  ["entry level", "entry"],
  ["associate", "entry"],
  ["mid-senior level", "mid"],
  ["director", "director"],
  ["executive", "director"],
]);

const WORKABLE_FIELDS = [
  "referencenumber",
  "title",
  "date",
  "url",
  "company",
  "city",
  "state",
  "country",
  "remote",
  "category",
  "experience",
  "jobtype",
  "description",
] as const;

type WorkableField = (typeof WORKABLE_FIELDS)[number];

export type WorkableJobFields = Partial<Record<WorkableField, string>>;

function isWorkableField(name: string): name is WorkableField {
  return WORKABLE_FIELDS.some((field) => field === name);
}

export function workableApplyUrl(reference: string, rawUrl: string) {
  const trimmed = rawUrl.trim();

  if (trimmed !== "") {
    return /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  return `https://apply.workable.com/j/${encodeURIComponent(reference)}`;
}

export function workableBoardToken(companyName: string) {
  const slug = normalizeTitle(companyName).replaceAll(" ", "-").slice(0, 60);

  return slug === "" ? "workable-company" : slug;
}

export function tagWorkableJob(fields: WorkableJobFields) {
  const title = fields.title?.trim() ?? "";
  const city = fields.city?.trim() ?? "";
  const state = fields.state?.trim() ?? "";
  const country = fields.country?.trim() ?? "";
  const locationRaw = [city, state, country].filter((part) => part !== "").join(", ") || null;
  const remoteText = fields.remote?.trim().toLowerCase() ?? "";
  const descriptionText = htmlToText(fields.description ?? "", DESCRIPTION_CAP);

  const tags = tagPosting({
    title,
    department: fields.category?.trim() || null,
    locationRaw,
    workplaceType: null,
    isRemote: remoteText === "" ? null : remoteText === "true",
    employmentType: fields.jobtype?.trim() || null,
    language: null,
    salary: null,
    descriptionText,
  });

  if (tags.workplace === "unknown" && remoteText === "false") {
    tags.workplace = "onsite";
  }

  if (tags.seniority === null) {
    const seniority = experienceSeniority.get(fields.experience?.trim().toLowerCase() ?? "");

    if (seniority !== undefined) {
      tags.seniority = seniority;
    }
  }

  return { descriptionText, locationRaw, tags };
}

function locationMatches(place: string, tags: PostingTags, locationRaw: string) {
  const resolved = resolveLocation(place);

  if (resolved.countryCode === null) {
    return locationRaw.toLowerCase().includes(place.toLowerCase());
  }

  if (tags.countryCode !== resolved.countryCode) {
    return false;
  }

  if (resolved.city !== null) {
    return tags.city !== null && tags.city.toLowerCase() === resolved.city.toLowerCase();
  }

  if (resolved.region !== null) {
    return tags.region !== null && tags.region.toLowerCase() === resolved.region.toLowerCase();
  }

  return true;
}

/**
 * Whether one Workable job's role meets any of the targets, in the role taxonomy: the seed label for its title, else
 * its rule tags through the retired-tag bridge, scored the way catalog matching scores a Posting.
 * @param job The job's title, department and rule tags.
 * @param roles The saved role targets.
 * @param labels The committed role labels by key, loaded once by the caller.
 * @returns True when the role matches.
 */
export function workableRoleMatches(
  job: { title: string; department: string | null; tags: PostingTags },
  roles: readonly string[],
  labels: ReadonlyMap<string, RoleLabel>,
) {
  const roleTags = taxonomyRoleTags(
    { title: job.title, department: job.department, primaryCategory: null, primaryRole: null },
    { role: job.tags.role, subrole: job.tags.subrole, granularRole: null, source: "rules" },
    labels,
  );

  return (
    roleMatchScore(planRoleTargets(roles), {
      titleNorm: normalizeTitle(job.title),
      tags: roleTags,
    }) > 0
  );
}

/**
 * Whether one Workable job meets the off-box pass's targets, read the way catalog matching reads them: its role in
 * the role taxonomy (the seed label for its title, else its rule tags through the retired-tag bridge), then
 * seniority, workplace and location.
 * @param job The job's title, department and rule tags.
 * @param locationRaw The job's location text.
 * @param targets The targets the pass keeps jobs for.
 * @param labels The committed role labels by key.
 * @returns True when the job should be kept.
 */
export function workableTargetMatches(
  job: { title: string; department: string | null; tags: PostingTags },
  locationRaw: string,
  targets: WorkableTargets,
  labels: ReadonlyMap<string, RoleLabel>,
) {
  const { tags } = job;

  if (targets.roles.length === 0 || !workableRoleMatches(job, targets.roles, labels)) {
    return false;
  }

  if (
    targets.seniorities.length > 0 &&
    (tags.seniority === null || !targets.seniorities.includes(tags.seniority))
  ) {
    return false;
  }

  if (targets.workplaces.length > 0 && !targets.workplaces.includes(tags.workplace)) {
    return false;
  }

  if (
    targets.employmentTypes.length > 0 &&
    !targets.employmentTypes.includes(tags.employmentType)
  ) {
    return false;
  }

  const places = locationTextsOfPlaceIds(targets.locations);

  return places.length === 0 || places.some((place) => locationMatches(place, tags, locationRaw));
}

export interface WorkablePassStats {
  feedJobs: number;
  discarded: number;
  duplicates: number;
  distinctReferences: number;
  matched: number;
  bytesIn: number;
  peakRssBytes: number;
}

function parsePostedAt(raw: string | undefined) {
  const trimmed = raw?.trim() ?? "";

  if (trimmed === "") {
    return null;
  }

  const parsed = Date.parse(trimmed);

  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function toSnapshotRow(fields: WorkableJobFields) {
  const reference = fields.referencenumber?.trim() ?? "";
  const title = fields.title?.trim() ?? "";
  const company = fields.company?.trim() ?? "";

  if (reference === "" || title === "" || company === "") {
    return null;
  }

  const { descriptionText, locationRaw, tags } = tagWorkableJob(fields);

  return {
    version: 1 as const,
    reference,
    title,
    company,
    url: workableApplyUrl(reference, fields.url ?? ""),
    applyUrl: workableApplyUrl(reference, fields.url ?? ""),
    postedAt: parsePostedAt(fields.date),
    locationRaw,
    department: fields.category?.trim() || null,
    descriptionText: descriptionText ?? "",
    tags,
  } satisfies WorkableSnapshotRow;
}

export interface WorkablePassDeps {
  source: AsyncIterable<Uint8Array>;
  targets: WorkableTargets;
  labels: ReadonlyMap<string, RoleLabel>;
  onMatch: (row: WorkableSnapshotRow, line: string) => Promise<void> | void;
}

export async function streamWorkablePass(deps: WorkablePassDeps) {
  const decoder = new TextDecoder("utf-8");
  const seen = new Set<string>();

  const stats: WorkablePassStats = {
    feedJobs: 0,
    discarded: 0,
    duplicates: 0,
    distinctReferences: 0,
    matched: 0,
    bytesIn: 0,
    peakRssBytes: process.memoryUsage.rss(),
  };

  let inJob = false;
  let currentTag: string | null = null;
  let currentText = "";
  let job: WorkableJobFields = {};
  const pending: WorkableSnapshotRow[] = [];

  function handleJob(fields: WorkableJobFields) {
    stats.feedJobs += 1;

    const reference = fields.referencenumber?.trim() ?? "";

    if (reference === "") {
      stats.discarded += 1;

      return;
    }

    if (seen.has(reference)) {
      stats.duplicates += 1;

      return;
    }

    seen.add(reference);
    stats.distinctReferences += 1;

    const row = toSnapshotRow(fields);

    if (row === null) {
      stats.discarded += 1;

      return;
    }

    if (workableTargetMatches(row, row.locationRaw ?? "", deps.targets, deps.labels)) {
      pending.push(row);
    }
  }

  async function flush() {
    const rows = pending.splice(0);

    stats.matched += rows.length;
    await Promise.all(
      rows.map(async (row) => {
        await deps.onMatch(row, `${JSON.stringify(row)}\n`);
      }),
    );
  }

  const parser = new Parser(
    {
      onopentag(name) {
        if (name === "job") {
          inJob = true;
          job = {};

          return;
        }

        if (inJob) {
          currentTag = name;
          currentText = "";
        }
      },
      ontext(text) {
        if (inJob && currentTag !== null) {
          currentText += text;
        }
      },
      onclosetag(name) {
        if (name === "job") {
          inJob = false;
          currentTag = null;
          handleJob(job);

          return;
        }

        if (inJob && currentTag === name) {
          if (isWorkableField(name)) {
            job[name] = currentText;
          }

          currentTag = null;
          currentText = "";
        }
      },
    },
    { xmlMode: true, decodeEntities: true },
  );

  for await (const chunk of deps.source) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    stats.bytesIn += buffer.length;
    parser.write(decoder.decode(buffer, { stream: true }));
    stats.peakRssBytes = Math.max(stats.peakRssBytes, process.memoryUsage.rss());
    await flush();
  }

  parser.write(decoder.decode());
  parser.end();
  await flush();

  return stats;
}
