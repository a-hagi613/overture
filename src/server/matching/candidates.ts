import { and, eq, exists, inArray, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { TargetsInput } from "../../shared/targets.ts";

import {
  applications,
  companies,
  postingTags,
  postings,
  postingUserState,
  skipCompanies,
} from "../platform/db/schema.ts";
import { SETTING_DEFAULTS, getSetting, getAllKillSwitches } from "../platform/settings/index.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { createFactService } from "../profile/facts.ts";
import { matchedRoleTags } from "../profile/targets.ts";
import { resolveLocation } from "../catalog/geo.ts";
import { salaryMeetsFloor } from "./fx.ts";
import { countryInRegion, remoteRegionOf } from "./regions.ts";
import { skipMatches } from "./skip-match.ts";

const DAY_MS = 86_400_000;

const SENIORITY_ORDER: readonly string[] = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
];

const ACTIVE_APPLICATION_STATUSES = [
  "preparing",
  "needs_review",
  "ready",
  "sending",
  "confirming",
] as const;

type TagDimension = "role" | "subrole" | "seniority";

export interface CandidatePosting {
  id: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  ats: "greenhouse" | "lever" | "ashby";
  title: string;
  locationRaw: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  workplace: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType: "full_time" | "part_time" | "contract" | "internship" | "temporary" | "unknown";
  language: string | null;
  salaryMinMinor: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "year" | "month" | "hour" | null;
  postedAt: number | null;
  dedupeKey: string;
  tags: { dimension: TagDimension; value: string }[];
}

export interface RankedCandidate extends CandidatePosting {
  codeRank: number;
}

interface TargetPlace {
  countryCode: string;
  city: string | null;
  region: string | null;
}

interface CandidateDeps {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
}

function targetPlaces(targets: TargetsInput) {
  const places: TargetPlace[] = [];

  for (const location of targets.locations) {
    const resolved = resolveLocation(location);

    if (resolved.countryCode !== null) {
      places.push({
        countryCode: resolved.countryCode,
        city: resolved.city,
        region: resolved.region,
      });
    }
  }

  return places;
}

function locationMatch(
  posting: CandidatePosting,
  places: readonly TargetPlace[],
  workAuthorised: boolean,
) {
  if (posting.workplace === "remote") {
    const macroRegion = remoteRegionOf(posting.locationRaw);

    if (posting.countryCode !== null) {
      return {
        matched: places.some((place) => place.countryCode === posting.countryCode),
        score: 15,
      };
    }

    if (macroRegion !== null && macroRegion !== "WORLDWIDE") {
      return {
        matched: places.some((place) => countryInRegion(place.countryCode, macroRegion)),
        score: 15,
      };
    }

    return { matched: workAuthorised, score: 15 };
  }

  let best = 0;

  for (const place of places) {
    if (posting.countryCode !== place.countryCode) {
      continue;
    }

    if (place.city === null && place.region === null) {
      best = Math.max(best, 5);

      continue;
    }

    if (place.city !== null) {
      if (posting.city !== null && posting.city.toLowerCase() === place.city.toLowerCase()) {
        best = Math.max(best, 15);
      }

      continue;
    }

    if (
      place.region !== null &&
      posting.region !== null &&
      posting.region.toLowerCase() === place.region.toLowerCase()
    ) {
      best = Math.max(best, 10);
    }
  }

  return { matched: best > 0, score: best };
}

function seniorityScore(posting: CandidatePosting, targetSeniorities: readonly string[]) {
  const postingSeniorities: string[] = [];

  for (const tag of posting.tags) {
    if (tag.dimension === "seniority") {
      postingSeniorities.push(tag.value);
    }
  }

  if (postingSeniorities.some((value) => targetSeniorities.includes(value))) {
    return 20;
  }

  for (const value of postingSeniorities) {
    const index = SENIORITY_ORDER.indexOf(value);

    if (index === -1) {
      continue;
    }

    const neighbours = [SENIORITY_ORDER[index - 1], SENIORITY_ORDER[index + 1]];

    if (
      neighbours.some(
        (neighbour) => neighbour !== undefined && targetSeniorities.includes(neighbour),
      )
    ) {
      return 10;
    }
  }

  return 0;
}

function recencyScore(postedAt: number | null, at: number) {
  if (postedAt === null) {
    return 0;
  }

  const age = at - postedAt;

  if (age <= 3 * DAY_MS) {
    return 10;
  }

  if (age <= 14 * DAY_MS) {
    return 5;
  }

  return 0;
}

function settingNumber(db: AppDatabase, key: keyof typeof SETTING_DEFAULTS) {
  const raw = getSetting(db, key);
  const parsed = raw === null ? Number.NaN : Number(raw);
  const fallback = Number(SETTING_DEFAULTS[key]);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function workAuthorisation(records: { key: string; value: string }[]) {
  const record = records.find((candidate) => candidate.key === "work_auth");

  return record?.value.trim().toLowerCase() === "yes";
}

export function createCandidateService(deps: CandidateDeps) {
  const { db, clock, personal } = deps;

  const facts = createFactService({ db, clock, personal });

  function pool(userId: string, targets: TargetsInput, languages: readonly string[]) {
    const roleTags = matchedRoleTags(db, targets.roles);

    if (
      roleTags.length === 0 ||
      targets.seniorities.length === 0 ||
      targets.workplaces.length === 0 ||
      targets.employmentTypes.length === 0 ||
      languages.length === 0
    ) {
      return [];
    }

    const rows = db
      .select({
        id: postings.id,
        companyId: postings.companyId,
        companyName: companies.name,
        companyDomain: companies.domain,
        ats: postings.ats,
        title: postings.title,
        locationRaw: postings.locationRaw,
        countryCode: postings.countryCode,
        region: postings.region,
        city: postings.city,
        workplace: postings.workplace,
        employmentType: postings.employmentType,
        language: postings.language,
        salaryMinMinor: postings.salaryMinMinor,
        salaryCurrency: postings.salaryCurrency,
        salaryPeriod: postings.salaryPeriod,
        postedAt: postings.postedAt,
        dedupeKey: postings.dedupeKey,
      })
      .from(postings)
      .innerJoin(companies, eq(postings.companyId, companies.id))
      .where(
        and(
          isNull(postings.closedAt),
          inArray(postings.workplace, targets.workplaces),
          inArray(postings.employmentType, targets.employmentTypes),
          inArray(
            sql`lower(${postings.language})`,
            languages.map((language) => language.toLowerCase()),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(postingTags)
              .where(
                and(
                  eq(postingTags.postingId, postings.id),
                  inArray(postingTags.dimension, ["role", "subrole"]),
                  inArray(postingTags.value, roleTags),
                ),
              ),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(postingTags)
              .where(
                and(
                  eq(postingTags.postingId, postings.id),
                  eq(postingTags.dimension, "seniority"),
                  inArray(postingTags.value, targets.seniorities),
                ),
              ),
          ),
        ),
      )
      .all();

    if (rows.length === 0) {
      return [];
    }

    const tagRows = db
      .select({
        postingId: postingTags.postingId,
        dimension: postingTags.dimension,
        value: postingTags.value,
      })
      .from(postingTags)
      .where(
        inArray(
          postingTags.postingId,
          rows.map((row) => row.id),
        ),
      )
      .all();

    const tagsById = new Map<string, CandidatePosting["tags"]>();

    for (const tag of tagRows) {
      const list = tagsById.get(tag.postingId) ?? [];

      list.push({ dimension: tag.dimension, value: tag.value });
      tagsById.set(tag.postingId, list);
    }

    const candidates: CandidatePosting[] = [];

    for (const row of rows) {
      candidates.push({ ...row, tags: tagsById.get(row.id) ?? [] });
    }

    return candidates;
  }

  async function ranked(userId: string, targets: TargetsInput, languages: readonly string[]) {
    const at = clock.now();
    const places = targetPlaces(targets);
    const workAuthorised = workAuthorisation(await facts.list(userId));

    const skipRows = db
      .select({
        companyId: skipCompanies.companyId,
        nameNorm: skipCompanies.nameNorm,
        domain: skipCompanies.domain,
      })
      .from(skipCompanies)
      .where(eq(skipCompanies.userId, userId))
      .all();

    const applicantRows = db
      .select({
        postingId: applications.postingId,
        companyId: applications.companyId,
        status: applications.status,
        sentAt: applications.sentAt,
        dedupeKey: postings.dedupeKey,
      })
      .from(applications)
      .innerJoin(postings, eq(applications.postingId, postings.id))
      .where(eq(applications.userId, userId))
      .all();

    const crowdRows = db
      .select({
        postingId: applications.postingId,
        companyId: applications.companyId,
        status: applications.status,
        sentAt: applications.sentAt,
      })
      .from(applications)
      .all();

    const cooldownDays = settingNumber(db, "limits.company_cooldown_days");
    const repostDays = settingNumber(db, "limits.repost_guard_days");
    const crowdPosting = settingNumber(db, "limits.crowd_per_posting");
    const crowdEmployer = settingNumber(db, "limits.crowd_per_employer_week");

    const activeCompanies = new Set<string>();
    const recentCompanies = new Set<string>();
    const repostKeys = new Set<string>();
    const appliedPostings = new Set<string>();
    const crowdByPosting = new Map<string, number>();
    const crowdByCompany = new Map<string, number>();

    for (const row of applicantRows) {
      appliedPostings.add(row.postingId);

      if (ACTIVE_APPLICATION_STATUSES.some((status) => status === row.status)) {
        activeCompanies.add(row.companyId);
      }

      if (row.status === "sent" && row.sentAt !== null) {
        if (row.sentAt >= at - cooldownDays * DAY_MS) {
          recentCompanies.add(row.companyId);
        }

        if (row.sentAt >= at - repostDays * DAY_MS) {
          repostKeys.add(row.dedupeKey);
        }
      }
    }

    for (const row of crowdRows) {
      if (row.status === "failed" || row.status === "skipped" || row.status === "withdrawn") {
        continue;
      }

      crowdByPosting.set(row.postingId, (crowdByPosting.get(row.postingId) ?? 0) + 1);

      if (row.status === "sent" && row.sentAt !== null && row.sentAt >= at - 7 * DAY_MS) {
        crowdByCompany.set(row.companyId, (crowdByCompany.get(row.companyId) ?? 0) + 1);
      }
    }

    const hidden = new Set(
      db
        .select({ postingId: postingUserState.postingId })
        .from(postingUserState)
        .where(and(eq(postingUserState.userId, userId), eq(postingUserState.state, "hidden")))
        .all()
        .map((row) => row.postingId),
    );

    const switches = getAllKillSwitches(db);
    const globalOff = switches.some((sw) => sw.scope === "global" && sw.enabled === 1);
    const atsOff = new Set<string>();
    const employerOff = new Set<string>();

    for (const sw of switches) {
      if (sw.enabled !== 1) {
        continue;
      }

      if (sw.scope === "ats") {
        atsOff.add(sw.key);
      }

      if (sw.scope === "employer") {
        employerOff.add(sw.key);
      }
    }

    if (globalOff) {
      return [];
    }

    const poolRows = pool(userId, targets, languages);
    const rankedRows: RankedCandidate[] = [];

    for (const posting of poolRows) {
      if (
        hidden.has(posting.id) ||
        appliedPostings.has(posting.id) ||
        activeCompanies.has(posting.companyId) ||
        recentCompanies.has(posting.companyId) ||
        repostKeys.has(posting.dedupeKey) ||
        (crowdByPosting.get(posting.id) ?? 0) >= crowdPosting ||
        (crowdByCompany.get(posting.companyId) ?? 0) >= crowdEmployer ||
        atsOff.has(posting.ats) ||
        employerOff.has(posting.companyId)
      ) {
        continue;
      }

      const location = locationMatch(posting, places, workAuthorised);

      if (!location.matched) {
        continue;
      }

      const salary =
        targets.salaryFloorMinor === null || targets.salaryCurrency === null
          ? { known: false, meets: true }
          : salaryMeetsFloor(
              db,
              at,
              posting,
              targets.salaryFloorMinor,
              targets.salaryCurrency,
              targets.salaryPeriod,
            );

      if (!salary.meets) {
        continue;
      }

      const skip = skipMatches(
        { id: posting.companyId, name: posting.companyName, domain: posting.companyDomain },
        skipRows,
      );

      if (skip.matched) {
        if (skip.near) {
          publishEvent(
            db,
            clock,
            "skip.near_match",
            JSON.stringify({ company: posting.companyName, postingId: posting.id }),
            userId,
          );
        }

        continue;
      }

      rankedRows.push({
        ...posting,
        codeRank:
          40 +
          seniorityScore(posting, targets.seniorities) +
          location.score +
          (salary.known ? 10 : 0) +
          recencyScore(posting.postedAt, at),
      });
    }

    return rankedRows.toSorted((left, right) => {
      if (right.codeRank !== left.codeRank) {
        return right.codeRank - left.codeRank;
      }

      const rightPosted = right.postedAt ?? 0;
      const leftPosted = left.postedAt ?? 0;

      if (rightPosted !== leftPosted) {
        return rightPosted - leftPosted;
      }

      return left.id.localeCompare(right.id);
    });
  }

  return { ranked };
}
