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
import { createLanguagesService } from "../profile/languages.ts";
import { createTargetsService, matchedRoleTags, roleTargetMatches } from "../profile/targets.ts";
import { resolveLocation } from "../catalog/geo.ts";
import { salaryMeetsFloor } from "./fx.ts";
import { countryInRegion, remoteRegionOf } from "./regions.ts";
import { skipMatches } from "./skip-match.ts";

import type { SkipTarget } from "./skip-match.ts";

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
  closedAt: number | null;
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
  atsOff: Set<string>;
  employerOff: Set<string>;
  globalOff: boolean;
}

type FilterReason =
  | "closed"
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
  | "kill_switch";

interface Verdict {
  reason: FilterReason | null;
  locationScore: number;
  salaryKnown: boolean;
  seniority: number;
}

function targetBasicsMatch(posting: CandidatePosting, targets: TargetsInput) {
  if (!targets.workplaces.some((workplace) => workplace === posting.workplace)) {
    return "workplace" satisfies FilterReason;
  }

  if (!targets.employmentTypes.some((type) => type === posting.employmentType)) {
    return "employment_type" satisfies FilterReason;
  }

  let roleMatch = false;

  for (const tag of posting.tags) {
    if (tag.dimension !== "role" && tag.dimension !== "subrole") {
      continue;
    }

    if (targets.roles.some((role) => roleTargetMatches(role, [tag.value]))) {
      roleMatch = true;
    }
  }

  if (!roleMatch) {
    return "role" satisfies FilterReason;
  }

  const seniorityMatch = posting.tags.some(
    (tag) =>
      tag.dimension === "seniority" && targets.seniorities.some((value) => value === tag.value),
  );

  if (!seniorityMatch) {
    return "seniority" satisfies FilterReason;
  }

  return null;
}

export function createCandidateService(deps: CandidateDeps) {
  const { db, clock, personal } = deps;

  const facts = createFactService({ db, clock, personal });
  const targetsService = createTargetsService({ db, clock });
  const languagesService = createLanguagesService({ db, clock });

  function tagsFor(postingIds: readonly string[]) {
    if (postingIds.length === 0) {
      return new Map<string, CandidatePosting["tags"]>();
    }

    const tagRows = db
      .select({
        postingId: postingTags.postingId,
        dimension: postingTags.dimension,
        value: postingTags.value,
      })
      .from(postingTags)
      .where(inArray(postingTags.postingId, [...postingIds]))
      .all();

    const tagsById = new Map<string, CandidatePosting["tags"]>();

    for (const tag of tagRows) {
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
    dedupeKey: postings.dedupeKey,
  };

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
      .select(postingColumns)
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

    const tagsById = tagsFor(rows.map((row) => row.id));

    const candidates: CandidatePosting[] = [];

    for (const row of rows) {
      candidates.push({ ...row, tags: tagsById.get(row.id) ?? [] });
    }

    return candidates;
  }

  function singlePosting(postingId: string) {
    const row = db
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

    return {
      activeCompanies,
      appliedPostings,
      at,
      atsOff,
      crowdByCompany,
      crowdByPosting,
      crowdEmployer: settingNumber(db, "limits.crowd_per_employer_week"),
      crowdPosting: settingNumber(db, "limits.crowd_per_posting"),
      employerOff,
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
    if (posting.closedAt !== null) {
      return {
        reason: "closed",
        locationScore: 0,
        salaryKnown: false,
        seniority: 0,
      } satisfies Verdict;
    }

    const language = posting.language?.toLowerCase() ?? "";

    if (!context.languages.some((candidate) => candidate.toLowerCase() === language)) {
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

    for (const posting of pool(userId, targets, languages)) {
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
