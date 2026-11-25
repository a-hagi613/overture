import { and, count, eq, exists, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { Ats } from "../../shared/ats.ts";
import type { TargetsInput } from "../../shared/targets.ts";

import { applications, postingUserState, skipCompanies } from "../platform/db/schema.ts";
import { companies, postingTags, postings } from "../platform/db/catalog-schema.ts";

import { getSettingNumber, getAllKillSwitches } from "../platform/settings/index.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { createFactService } from "../profile/facts.ts";
import { createLanguagesService } from "../profile/languages.ts";
import { createTargetsService, matchedRoleTags, roleTargetMatches } from "../profile/targets.ts";
import { resolveLocation, sameRegion } from "../catalog/geo.ts";
import { ACTIVE_APPLICATION_STATUSES } from "./applications.ts";
import { salaryMeetsFloor } from "./fx.ts";
import { countryInRegion, remoteRegionOf } from "./regions.ts";
import { skipMatches } from "./skip-match.ts";
import { flaggedPostingIds } from "./posting-flags.ts";
import {
  employmentAccepted,
  languageAccepted,
  nearestSeniorityDistance,
  optionalFieldConditions,
  seniorityAccepted,
  workplaceAccepted,
} from "./optional-fields.ts";

import type { SkipTarget } from "./skip-match.ts";

const DAY_MS = 86_400_000;
const POOL_TTL_MS = 30_000;
const POOL_CACHE_MAX_ENTRIES = 50;

type TagDimension = "role" | "subrole" | "granular_role" | "seniority";

export interface CandidatePosting {
  id: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  ats: Ats;
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
  closedAt: number | null;
  status: "open" | "closed";
  applySupported: boolean;
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
  catalogDb: CatalogDatabase;
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

    if (place.region !== null && sameRegion(posting.countryCode, posting.region, place.region)) {
      best = Math.max(best, 10);
    }
  }

  return { matched: best > 0, score: best };
}

function seniorityScore(posting: CandidatePosting, targetSeniorities: readonly string[]) {
  const distance = nearestSeniorityDistance(
    posting.tags.filter((tag) => tag.dimension === "seniority").map((tag) => tag.value),
    targetSeniorities,
  );

  if (distance === 0) {
    return 20;
  }

  return distance === 1 ? 10 : 0;
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

function workAuthorisation(records: { key: string; scope: string; value: string }[]) {
  const record = records.find(
    (candidate) => candidate.key === "work_auth" && candidate.scope === "",
  );

  return record?.value.trim().toLowerCase() === "yes";
}

interface FilterContext {
  userId: string;
  at: number;
  targets: TargetsInput;
  languages: readonly string[];
  places: TargetPlace[];
  workAuthorised: boolean;
  skipRows: SkipTarget[];
  activeCompanies: Set<string>;
  recentCompanies: Set<string>;
  repostKeys: Set<string>;
  appliedPostings: Set<string>;
  crowdByPosting: Map<string, number>;
  crowdByCompany: Map<string, number>;
  crowdPosting: number;
  crowdEmployer: number;
  hidden: Set<string>;
  flaggedPostings: Set<string>;
  atsOff: Set<string>;
  employerOff: Set<string>;
  globalOff: boolean;
}

type FilterReason =
  | "closed"
  | "apply_unsupported"
  | "role"
  | "seniority"
  | "workplace"
  | "employment_type"
  | "language"
  | "location"
  | "salary"
  | "skip_list"
  | "current_employer"
  | "already_applied"
  | "open_application_company"
  | "company_cooldown"
  | "repost_guard"
  | "crowd_limit"
  | "hidden"
  | "flagged"
  | "kill_switch";

interface Verdict {
  reason: FilterReason | null;
  locationScore: number;
  salaryKnown: boolean;
  seniority: number;
}

function targetBasicsMatch(posting: CandidatePosting, targets: TargetsInput) {
  if (!workplaceAccepted(posting.workplace, targets.workplaces)) {
    return "workplace" satisfies FilterReason;
  }

  if (!employmentAccepted(posting.employmentType, targets.employmentTypes)) {
    return "employment_type" satisfies FilterReason;
  }

  let roleMatch = false;

  for (const tag of posting.tags) {
    if (
      tag.dimension !== "role" &&
      tag.dimension !== "subrole" &&
      tag.dimension !== "granular_role"
    ) {
      continue;
    }

    if (targets.roles.some((role) => roleTargetMatches(role, [tag.value]))) {
      roleMatch = true;
    }
  }

  if (!roleMatch) {
    return "role" satisfies FilterReason;
  }

  const postingSeniorities = posting.tags
    .filter((tag) => tag.dimension === "seniority")
    .map((tag) => tag.value);

  if (!seniorityAccepted(postingSeniorities, targets.seniorities)) {
    return "seniority" satisfies FilterReason;
  }

  return null;
}

export function createCandidateService(deps: CandidateDeps) {
  const { db, catalogDb, clock, personal } = deps;

  const facts = createFactService({ db, clock, personal });
  const targetsService = createTargetsService({ db, clock });
  const languagesService = createLanguagesService({ db, clock });

  function tagsFor(postingIds: readonly string[]) {
    if (postingIds.length === 0) {
      return new Map<string, CandidatePosting["tags"]>();
    }

    const tagRows = catalogDb
      .select({
        postingId: postingTags.postingId,
        dimension: postingTags.dimension,
        value: postingTags.value,
      })
      .from(postingTags)
      .where(
        and(
          inArray(postingTags.postingId, [...postingIds]),
          inArray(postingTags.dimension, ["role", "subrole", "granular_role", "seniority"]),
        ),
      )
      .all();

    const tagsById = new Map<string, CandidatePosting["tags"]>();

    for (const tag of tagRows) {
      if (
        tag.dimension !== "role" &&
        tag.dimension !== "subrole" &&
        tag.dimension !== "granular_role" &&
        tag.dimension !== "seniority"
      ) {
        continue;
      }

      const list = tagsById.get(tag.postingId) ?? [];

      list.push({ dimension: tag.dimension, value: tag.value });
      tagsById.set(tag.postingId, list);
    }

    return tagsById;
  }

  const postingColumns = {
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
    closedAt: postings.closedAt,
    status: postings.status,
    applySupported: postings.applySupported,
    dedupeKey: postings.dedupeKey,
  };

  function loadPool(targets: TargetsInput, languages: readonly string[]) {
    const roleTags = matchedRoleTags(catalogDb, targets.roles);

    if (
      roleTags.length === 0 ||
      targets.seniorities.length === 0 ||
      targets.workplaces.length === 0 ||
      targets.employmentTypes.length === 0 ||
      languages.length === 0
    ) {
      return [];
    }

    const rows = catalogDb
      .select(postingColumns)
      .from(postings)
      .innerJoin(companies, eq(postings.companyId, companies.id))
      .where(
        and(
          isNull(postings.closedAt),
          eq(postings.status, "open"),
          eq(postings.applySupported, true),
          ...optionalFieldConditions(catalogDb, { ...targets, languages }),
          exists(
            catalogDb
              .select({ one: sql`1` })
              .from(postingTags)
              .where(
                and(
                  eq(postingTags.postingId, postings.id),
                  inArray(postingTags.dimension, ["role", "subrole", "granular_role"]),
                  inArray(postingTags.value, roleTags),
                ),
              ),
          ),
        ),
      )
      .all();

    const tagsById = tagsFor(rows.map((row) => row.id));

    const candidates: CandidatePosting[] = [];

    for (const row of rows) {
      candidates.push({ ...row, tags: tagsById.get(row.id) ?? [] });
    }

    return candidates;
  }

  const poolCache = new Map<
    string,
    { loadedAt: number; version: string; rows: readonly CandidatePosting[] }
  >();

  function catalogVersion() {
    const [row] = catalogDb.all<{ lastRow: number | null; lastClosed: number | null }>(
      sql`SELECT max(rowid) AS lastRow, max(closed_at) AS lastClosed FROM postings`,
    );

    return `${String(row?.lastRow)}:${String(row?.lastClosed)}`;
  }

  function pool(targets: TargetsInput, languages: readonly string[]) {
    const key = JSON.stringify([
      targets.roles.toSorted(),
      targets.seniorities.toSorted(),
      targets.workplaces.toSorted(),
      targets.employmentTypes.toSorted(),
      languages.map((language) => language.toLowerCase()).toSorted(),
    ]);

    const now = clock.now();
    const version = catalogVersion();
    const cached = poolCache.get(key);

    if (cached?.version === version && now - cached.loadedAt < POOL_TTL_MS) {
      return cached.rows;
    }

    const rows = loadPool(targets, languages);

    poolCache.delete(key);
    poolCache.set(key, { loadedAt: now, version, rows });

    if (poolCache.size > POOL_CACHE_MAX_ENTRIES) {
      const oldest = poolCache.keys().next();

      if (oldest.done !== true) {
        poolCache.delete(oldest.value);
      }
    }

    return rows;
  }

  function singlePosting(postingId: string) {
    const row = catalogDb
      .select(postingColumns)
      .from(postings)
      .innerJoin(companies, eq(postings.companyId, companies.id))
      .where(eq(postings.id, postingId))
      .get();

    if (row === undefined) {
      return null;
    }

    return { ...row, tags: tagsFor([row.id]).get(row.id) ?? [] };
  }

  async function filterContext(
    userId: string,
    targets: TargetsInput,
    languages: readonly string[],
  ) {
    const at = clock.now();
    const places = targetPlaces(targets);
    const workAuthorised = workAuthorisation(await facts.list(userId));

    const skipRows = db
      .select({
        companyId: skipCompanies.companyId,
        nameNorm: skipCompanies.nameNorm,
        domain: skipCompanies.domain,
        reason: skipCompanies.reason,
      })
      .from(skipCompanies)
      .where(eq(skipCompanies.userId, userId))
      .all();

    const applicationRows = db
      .select({
        postingId: applications.postingId,
        companyId: applications.companyId,
        status: applications.status,
        sentAt: applications.sentAt,
      })
      .from(applications)
      .where(eq(applications.userId, userId))
      .all();

    const dedupeKeys = new Map(
      catalogDb
        .select({ id: postings.id, dedupeKey: postings.dedupeKey })
        .from(postings)
        .where(
          inArray(
            postings.id,
            applicationRows.map((row) => row.postingId),
          ),
        )
        .all()
        .map((row) => [row.id, row.dedupeKey]),
    );

    const applicantRows = applicationRows.flatMap((row) => {
      const dedupeKey = dedupeKeys.get(row.postingId);

      return dedupeKey === undefined ? [] : [{ ...row, dedupeKey }];
    });

    const crowdPostingRows = db
      .select({ postingId: applications.postingId, total: count() })
      .from(applications)
      .where(notInArray(applications.status, ["failed", "skipped", "withdrawn"]))
      .groupBy(applications.postingId)
      .all();

    const crowdCompanyRows = db
      .select({ companyId: applications.companyId, total: count() })
      .from(applications)
      .where(and(eq(applications.status, "sent"), gte(applications.sentAt, at - 7 * DAY_MS)))
      .groupBy(applications.companyId)
      .all();

    const cooldownDays = getSettingNumber(db, "limits.company_cooldown_days");
    const repostDays = getSettingNumber(db, "limits.repost_guard_days");

    const activeCompanies = new Set<string>();
    const recentCompanies = new Set<string>();
    const repostKeys = new Set<string>();
    const appliedPostings = new Set<string>();

    for (const row of applicantRows) {
      appliedPostings.add(row.postingId);

      if (ACTIVE_APPLICATION_STATUSES.some((status) => status === row.status)) {
        activeCompanies.add(row.companyId);
      }

      if (
        row.status === "sent" &&
        row.sentAt !== null &&
        row.sentAt >= at - cooldownDays * DAY_MS
      ) {
        recentCompanies.add(row.companyId);
      }

      if (
        (row.status === "sent" || row.status === "failed") &&
        row.sentAt !== null &&
        row.sentAt >= at - repostDays * DAY_MS
      ) {
        repostKeys.add(row.dedupeKey);
      }
    }

    const crowdByPosting = new Map(crowdPostingRows.map((row) => [row.postingId, row.total]));
    const crowdByCompany = new Map(crowdCompanyRows.map((row) => [row.companyId, row.total]));

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

    return {
      activeCompanies,
      appliedPostings,
      at,
      atsOff,
      crowdByCompany,
      crowdByPosting,
      crowdEmployer: getSettingNumber(db, "limits.crowd_per_employer_week"),
      crowdPosting: getSettingNumber(db, "limits.crowd_per_posting"),
      employerOff,
      flaggedPostings: flaggedPostingIds(db),
      globalOff,
      hidden,
      languages,
      places,
      recentCompanies,
      repostKeys,
      skipRows,
      targets,
      userId,
      workAuthorised,
    } satisfies FilterContext;
  }

  function evaluatePosting(
    posting: CandidatePosting,
    context: FilterContext,
    checkApplied: boolean,
  ) {
    if (posting.closedAt !== null || posting.status === "closed") {
      return {
        reason: "closed",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (!posting.applySupported) {
      return {
        reason: "apply_unsupported",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (!languageAccepted(posting.language, context.languages)) {
      return {
        reason: "language",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (
      context.globalOff ||
      context.atsOff.has(posting.ats) ||
      context.employerOff.has(posting.companyId)
    ) {
      return {
        reason: "kill_switch",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (context.hidden.has(posting.id)) {
      return {
        reason: "hidden",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (context.flaggedPostings.has(posting.id)) {
      return {
        reason: "flagged",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    const basics = targetBasicsMatch(posting, context.targets);

    if (basics !== null) {
      return {
        reason: basics,
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (checkApplied && context.appliedPostings.has(posting.id)) {
      return {
        reason: "already_applied",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (context.activeCompanies.has(posting.companyId)) {
      return {
        reason: "open_application_company",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (context.recentCompanies.has(posting.companyId)) {
      return {
        reason: "company_cooldown",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (context.repostKeys.has(posting.dedupeKey)) {
      return {
        reason: "repost_guard",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    if (
      (context.crowdByPosting.get(posting.id) ?? 0) >= context.crowdPosting ||
      (context.crowdByCompany.get(posting.companyId) ?? 0) >= context.crowdEmployer
    ) {
      return {
        reason: "crowd_limit",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    const location = locationMatch(posting, context.places, context.workAuthorised);

    if (!location.matched) {
      return {
        reason: "location",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    const salary =
      context.targets.salaryFloorMinor === null || context.targets.salaryCurrency === null
        ? { known: false, meets: true }
        : salaryMeetsFloor(
            db,
            context.at,
            posting,
            context.targets.salaryFloorMinor,
            context.targets.salaryCurrency,
            context.targets.salaryPeriod,
          );

    if (!salary.meets) {
      return {
        reason: "salary",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    const skip = skipMatches(
      { id: posting.companyId, name: posting.companyName, domain: posting.companyDomain },
      context.skipRows,
    );

    if (skip.matched) {
      if (skip.near) {
        publishEvent(
          db,
          clock,
          "skip.near_match",
          JSON.stringify({ company: posting.companyName, postingId: posting.id }),
          context.userId,
        );
      }

      return {
        reason: skip.reason === "current_employer" ? "current_employer" : "skip_list",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    return {
      reason: null,
      locationScore: location.score,
      salaryKnown: salary.known,
      seniority: seniorityScore(posting, context.targets.seniorities),
    } satisfies Verdict;
  }

  async function ranked(userId: string, targets: TargetsInput, languages: readonly string[]) {
    const context = await filterContext(userId, targets, languages);

    if (context.globalOff) {
      return [];
    }

    const rankedRows: RankedCandidate[] = [];

    for (const posting of pool(targets, languages)) {
      const verdict = evaluatePosting(posting, context, true);

      if (verdict.reason !== null) {
        continue;
      }

      rankedRows.push({
        ...posting,
        codeRank:
          40 +
          verdict.seniority +
          verdict.locationScore +
          (verdict.salaryKnown ? 10 : 0) +
          recencyScore(posting.postedAt, context.at),
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

  async function check(userId: string, postingId: string) {
    const posting = singlePosting(postingId);

    if (posting === null) {
      return null;
    }

    const targets = await targetsService.read(userId);
    const { languages } = await languagesService.read(userId);
    const context = await filterContext(userId, targets.targets, languages);

    return evaluatePosting(posting, context, false).reason;
  }

  return { check, ranked };
}
