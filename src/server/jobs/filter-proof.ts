import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

import type { FreehireJobRecord } from "../../shared/freehire.ts";
import type { TargetsInput } from "../../shared/targets.ts";

import { atsForFreehireSource } from "../../shared/freehire.ts";
import { isNonJobTitle, normalizeJobTitle } from "../../shared/non-job.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { jobs } from "../platform/db/schema.ts";
import { createJobsPool } from "../matching/jobs-pool.ts";
import type { PullPreferences } from "./preferences.ts";
import { createJobStore } from "./store.ts";

/** One place a persona will accept, in the same shape as the saved place ids from #683. */
export interface PersonaPlace {
  /** A freehire place id, such as `country:ca` or `remote:country:ca`. */
  id: string;
  country?: string;
  city?: string;
  remote?: boolean;
}

/** A graded or walk profile the filter proof runs. */
export interface FilterPersona {
  key: string;
  name: string;
  headline: string;
  /** `graded` is one of the 12 fields, `walk` is a 26 Nov test user, `owner` is King Kong's real targets. */
  group: "graded" | "walk" | "owner";
  languages: string[];
  /** The freehire categories the person picks: one side of the role filter. */
  categories: string[];
  /** The title words the person picks: the other side of the role filter. */
  titleWords: string[];
  places: PersonaPlace[];
  /** Categories that count as the person's field when grading: the same families they pick. */
  fieldCategories: string[];
  /** Titles that count as the person's field when grading, independent of the filter's title words. */
  fieldTitle: RegExp;
}

const SOFTWARE_CATEGORIES = [
  "software_engineering",
  "backend",
  "frontend",
  "fullstack",
  "mobile",
  "devops",
  "sre",
  "qa",
  "ai_engineering",
  "embedded",
  "network_engineering",
  "security",
];

const SOFTWARE_TITLE =
  /\b(?:software|developer|backend|back[- ]?end|frontend|front[- ]?end|full[- ]?stack|devops|sre|site reliability|mobile|ios|android|programmer)\b/iu;

const BACKEND_TITLE =
  /\b(?:backend|back[- ]?end|software engineer(?:ing)?|software developer|developer|full[- ]?stack|programmer)\b/iu;

const GULF = [
  { id: "country:ae", country: "ae" },
  { id: "country:sa", country: "sa" },
  { id: "country:qa", country: "qa" },
  { id: "country:kw", country: "kw" },
  { id: "country:bh", country: "bh" },
  { id: "country:om", country: "om" },
] satisfies PersonaPlace[];

/**
 * The 12 graded fields from issue #685, King Kong's real targets and the three 26 Nov walk users. Each persona
 * carries what the person picks (the filter) and the role titles used only for grading, so the missed-right-job rate
 * is not measured with the same title words that decide the pool.
 */
export const FILTER_PERSONAS: readonly FilterPersona[] = [
  {
    key: "nurse",
    name: "Nurse",
    headline: "Registered nurse, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["healthcare"],
    titleWords: ["nurse", "nursing", "registered nurse", "registered practical nurse"],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["healthcare"],
    fieldTitle: /\b(?:nurse|nursing|registered practical)\b/iu,
  },
  {
    key: "backend-engineer",
    name: "Backend engineer",
    headline: "Backend engineer, Toronto or remote in Canada",
    group: "graded",
    languages: ["en"],
    categories: ["backend", "software_engineering", "fullstack"],
    titleWords: ["backend", "back-end", "software engineer", "developer"],
    places: [
      { id: "city:ca:toronto", country: "ca", city: "toronto" },
      { id: "remote:country:ca", country: "ca", remote: true },
    ],
    fieldCategories: ["backend", "software_engineering", "fullstack"],
    fieldTitle: BACKEND_TITLE,
  },
  {
    key: "retail",
    name: "Retail",
    headline: "Retail associate, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["retail", "hospitality"],
    titleWords: ["retail", "store associate", "sales associate", "cashier"],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["retail", "hospitality"],
    fieldTitle:
      /\b(?:retail|store|cashier|merchandis|shop assistant|sales associate|sales advisor)\b/iu,
  },
  {
    key: "customer-service",
    name: "Customer service",
    headline: "Customer service representative, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["support", "customer_success"],
    titleWords: ["customer service", "customer support", "call center", "help desk"],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["support", "customer_success"],
    fieldTitle:
      /\b(?:customer (?:service|support|care)|call cent|help ?desk|client support|support (?:agent|specialist|representative))\b/iu,
  },
  {
    key: "accountant",
    name: "Accountant",
    headline: "Accountant, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["finance"],
    titleWords: ["accountant", "accounting", "bookkeeper", "payroll", "auditor"],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["finance"],
    fieldTitle: /\b(?:accountant|accounting|bookkeep|payroll|audit|tax)\b/iu,
  },
  {
    key: "truck-driver",
    name: "Truck driver",
    headline: "Truck driver, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["logistics"],
    titleWords: ["truck driver", "driver", "delivery driver", "cdl"],
    places: [{ id: "country:ca", country: "ca" }],
    fieldCategories: ["logistics"],
    fieldTitle: /\b(?:truck|driver|delivery|chauffeur|transport|haul)\b/iu,
  },
  {
    key: "teaching-assistant",
    name: "Teaching assistant",
    headline: "Teaching assistant, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["education"],
    titleWords: [
      "teaching assistant",
      "teacher assistant",
      "educational assistant",
      "teacher aide",
    ],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["education"],
    fieldTitle:
      /\b(?:teaching assistant|teacher assistant|educational assistant|teacher aide|classroom assistant|education assistant)\b/iu,
  },
  {
    key: "marketing-manager",
    name: "Marketing manager",
    headline: "Marketing manager, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["marketing"],
    titleWords: ["marketing manager", "marketing", "growth"],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["marketing"],
    fieldTitle: /\b(?:marketing|growth|brand|content|seo|social media)\b/iu,
  },
  {
    key: "data-engineer",
    name: "Data engineer",
    headline: "Data engineer, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["data_engineering", "data_analytics"],
    titleWords: ["data engineer", "data analyst", "analytics"],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["data_engineering", "data_analytics"],
    fieldTitle:
      /\b(?:data (?:engineer|analyst|scientist)|analytics|business intelligence|machine learning|ml engineer)\b/iu,
  },
  {
    key: "caregiver",
    name: "Caregiver",
    headline: "Caregiver, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["social_services", "personal_services", "healthcare"],
    titleWords: ["caregiver", "personal support worker", "care aide", "home care"],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["social_services", "personal_services", "healthcare"],
    fieldTitle:
      /\b(?:caregiver|personal support|care aide|home care|support worker|care assistant)\b/iu,
  },
  {
    key: "electrician",
    name: "Electrician",
    headline: "Electrician, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["skilled_trades"],
    titleWords: ["electrician", "electrical", "apprentice electrician"],
    places: [{ id: "country:ca", country: "ca" }],
    fieldCategories: ["skilled_trades"],
    fieldTitle: /\b(?:electrician|electrical|electric)\b/iu,
  },
  {
    key: "account-executive",
    name: "Account executive",
    headline: "Account executive, Toronto",
    group: "graded",
    languages: ["en"],
    categories: ["sales"],
    titleWords: ["account executive", "sales", "account manager"],
    places: [{ id: "city:ca:toronto", country: "ca", city: "toronto" }],
    fieldCategories: ["sales"],
    fieldTitle: /\b(?:account executive|sales|account manager|business development|bdr|sdr)\b/iu,
  },
  {
    key: "king-kong",
    name: "King Kong",
    headline:
      "Five-year backend engineer in Toronto; Backend + Full-Stack, Toronto + Remote Canada",
    group: "owner",
    languages: ["en"],
    categories: ["backend", "fullstack"],
    titleWords: ["backend", "full-stack", "software engineer", "developer"],
    places: [
      { id: "city:ca:toronto", country: "ca", city: "toronto" },
      { id: "remote:country:ca", country: "ca", remote: true },
    ],
    fieldCategories: ["backend", "fullstack"],
    fieldTitle: BACKEND_TITLE,
  },
  {
    key: "maya",
    name: "Maya Chen",
    headline: "Software engineer, remote or hybrid in Canada",
    group: "walk",
    languages: ["en"],
    categories: [...SOFTWARE_CATEGORIES],
    titleWords: ["software", "developer", "backend", "frontend", "fullstack", "devops"],
    places: [{ id: "remote:country:ca", country: "ca", remote: true }],
    fieldCategories: SOFTWARE_CATEGORIES,
    fieldTitle: SOFTWARE_TITLE,
  },
  {
    key: "amina",
    name: "Amina Yusuf",
    headline: "Primary and secondary teacher, Ottawa or the Gulf in person",
    group: "walk",
    languages: ["en"],
    categories: ["education"],
    titleWords: [
      "teacher",
      "teaching",
      "tutor",
      "instructor",
      "primary teacher",
      "secondary teacher",
    ],
    places: [{ id: "city:ca:ottawa", country: "ca", city: "ottawa" }, ...GULF],
    fieldCategories: ["education"],
    fieldTitle: /\b(?:teacher|teaching|tutor|instructor|educator)\b/iu,
  },
  {
    key: "daniel",
    name: "Daniel Okafor",
    headline: "Administrative roles, remote in Canada or hybrid in Ottawa",
    group: "walk",
    languages: ["en"],
    categories: ["administration", "operations"],
    titleWords: [
      "administrative",
      "administration assistant",
      "office",
      "office administrator",
      "operations",
      "operations coordinator",
    ],
    places: [
      { id: "remote:country:ca", country: "ca", remote: true },
      { id: "city:ca:ottawa", country: "ca", city: "ottawa" },
    ],
    fieldCategories: ["administration", "operations"],
    fieldTitle: /\b(?:admin|administrative|administration|office|operations)\b/iu,
  },
];

/**
 * The production preferences a persona's choices become: exact place ids for the pool and the freehire facets the
 * pull searches.
 * @param persona The persona.
 * @returns The preferences the production pull and pool consume.
 */
export function preferencesFor(persona: Persona) {
  const countries = new Set<string>();
  const cities = new Set<string>();

  for (const place of persona.places) {
    if (place.country !== undefined) {
      countries.add(place.country);
    }

    if (place.city !== undefined) {
      cities.add(place.city);
    }
  }

  return {
    categories: persona.categories,
    cities: [...cities].toSorted(),
    countries: [...countries].toSorted(),
    languages: persona.languages,
    metros: [],
    placeIds: persona.places.map((place) => place.id),
    regions: [],
    titleWords: persona.titleWords,
  } satisfies PullPreferences;
}

type Persona = Pick<
  FilterPersona,
  "categories" | "titleWords" | "fieldCategories" | "fieldTitle" | "languages" | "places"
>;

function targetsFor(persona: Persona) {
  return {
    locations: persona.places.map((place) => place.id),
    roles: [...persona.categories, ...persona.titleWords],
    unresolvedLocations: [],
    unresolvedRoles: [],
  } satisfies TargetsInput;
}

function titleMatches(row: { title: string }, words: readonly string[]) {
  const title = ` ${normalizeJobTitle(row.title)} `;

  return words.some((word) => {
    const needle = normalizeJobTitle(word);

    return needle !== "" && title.includes(` ${needle} `);
  });
}

function stringArrayFromJson(value: string) {
  const parsed: unknown = JSON.parse(value);
  const result = z.array(z.string()).safeParse(parsed);

  return result.success ? result.data : [];
}

const stringListSchema = z.union([z.array(z.string()), z.string()]).nullable();

function stringList(value: string | readonly string[] | null) {
  const parsed = stringListSchema.safeParse(value);

  if (!parsed.success || parsed.data === null) {
    return [];
  }

  return Array.isArray(parsed.data) ? parsed.data : stringArrayFromJson(parsed.data);
}

/**
 * Whether a stored job sits in one of the persona's places under the #683 rules: a physical country or city id, or a
 * remote country that needs freehire to mark the posting remote.
 * @param row The stored job.
 * @param places The persona's places.
 * @returns True when at least one place matches.
 */
export function locationMatches(
  row: {
    countries: string | readonly string[];
    cities: string | readonly string[] | null;
    workMode: string | null;
  },
  places: readonly PersonaPlace[],
) {
  const countries = new Set(stringList(row.countries).map((country) => country.toLowerCase()));

  const cities = new Set(stringList(row.cities).map((city) => city.toLowerCase()));

  return places.some((place) => {
    if (place.remote === true) {
      return (
        place.country !== undefined &&
        row.workMode === "remote" &&
        countries.has(place.country.toLowerCase())
      );
    }

    if (place.city !== undefined) {
      return countries.size > 0 && cities.has(place.city.toLowerCase());
    }

    return place.country !== undefined && countries.has(place.country.toLowerCase());
  });
}

function placeMatches(
  row: {
    countries?: string | readonly string[];
    cities?: string | readonly string[] | null;
    workMode?: string | null;
    placeIds?: readonly string[];
  },
  persona: Persona,
) {
  if (row.placeIds !== undefined) {
    return persona.places.some((place) => row.placeIds?.includes(place.id) === true);
  }

  return locationMatches(
    {
      cities: row.cities ?? null,
      countries: row.countries ?? [],
      workMode: row.workMode ?? null,
    },
    persona.places,
  );
}

/**
 * The independent grade for one stored job: the persona's category family or a role title, the place rules, a
 * language the person reads, and a real job rather than a talent pool or test row.
 * @param row The stored job.
 * @param persona The persona.
 * @returns Whether the job is one the person would genuinely want.
 */
export function isRightJob(
  row: {
    category: string | null;
    countries?: string | readonly string[];
    cities?: string | readonly string[] | null;
    workMode?: string | null;
    placeIds?: readonly string[];
    language: string | null;
    title: string;
  },
  persona: Persona,
) {
  const languageRight =
    row.language === null ||
    row.language.trim() === "" ||
    persona.languages.some((language) => language.toLowerCase() === row.language?.toLowerCase());

  const roleRight =
    (row.category !== null && persona.fieldCategories.includes(row.category)) ||
    persona.fieldTitle.test(row.title);

  const placeRight = placeMatches(row, persona);

  return languageRight && roleRight && !isNonJobTitle(row.title) && placeRight;
}

interface PersonaMetrics {
  key: string;
  name: string;
  group: FilterPersona["group"];
  pool: number;
  wrongField: number;
  wrongFieldRate: number;
  rightJobs: number;
  missedRight: number;
  missedRightRate: number;
  titleOnly: number;
  titleOnlyNullCategory: number;
  titleOnlyOtherCategory: number;
  locationWrong: number;
}

export interface FilterProofResult {
  generatedAt: string;
  storedJobs: number;
  recordedJobs: number;
  nonJobs: number;
  languages: Record<string, number>;
  personas: PersonaMetrics[];
  wrongField: number;
  pool: number;
  wrongFieldRate: number;
}

const REPORT_DATE = "2026-11-26";

/**
 * Runs the production matching pool for every persona against the recorded freehire pull and grades each pool with
 * the independent field rules. No network call is made: the pull is a committed fixture.
 * @param records The recorded freehire jobs.
 * @returns The per-persona and aggregate metrics.
 */
export function runFilterProof(records: readonly FreehireJobRecord[]) {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const store = createJobStore({ db, clock: { now: () => Date.parse("2026-11-26T12:00:00Z") } });
  let storedJobs = 0;

  for (const record of records) {
    const ats = atsForFreehireSource(record.source);

    if (ats === null) {
      continue;
    }

    const outcome = store.upsert(record, {
      applyUrl: `https://example.test/${record.public_slug}`,
      ats,
      atsJobId: "1",
      boardToken: "board",
      via: "direct",
    });

    if (outcome.status === "kept") {
      storedJobs += 1;
    }
  }

  const poolReader = createJobsPool({
    clock: { now: () => Date.parse("2026-11-26T12:00:00Z") },
    db,
  });

  const rows = db.select().from(jobs).all();
  const metrics: PersonaMetrics[] = [];

  for (const persona of FILTER_PERSONAS) {
    const pool = poolReader.read("filter-proof", targetsFor(persona), persona.languages).jobs;
    const poolIds = new Set(pool.map((row) => row.id));
    const rightJobs = rows.filter((row) => isRightJob(row, persona));
    const wrong = pool.filter((row) => !isRightJob(row, persona));
    const missed = rightJobs.filter((row) => !poolIds.has(row.id));

    const titleOnlyRows = pool.filter(
      (row) =>
        (row.category === null || !persona.categories.includes(row.category)) &&
        titleMatches(row, persona.titleWords),
    );

    metrics.push({
      group: persona.group,
      key: persona.key,
      locationWrong: wrong.filter((row) => !placeMatches(row, persona)).length,
      missedRight: missed.length,
      missedRightRate: rightJobs.length === 0 ? 0 : missed.length / rightJobs.length,
      name: persona.name,
      pool: pool.length,
      rightJobs: rightJobs.length,
      titleOnly: titleOnlyRows.length,
      titleOnlyNullCategory: titleOnlyRows.filter((row) => row.category === null).length,
      titleOnlyOtherCategory: titleOnlyRows.filter((row) => row.category === "other").length,
      wrongField: wrong.length,
      wrongFieldRate: pool.length === 0 ? 0 : wrong.length / pool.length,
    });
  }

  const pool = metrics.reduce((sum, persona) => sum + persona.pool, 0);
  const wrongField = metrics.reduce((sum, persona) => sum + persona.wrongField, 0);
  const languageCounts = new Map<string, number>();

  for (const row of rows) {
    const language = row.language ?? "undetected";

    languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }

  return {
    generatedAt: REPORT_DATE,
    languages: Object.fromEntries(
      [...languageCounts.entries()].toSorted((left, right) => right[1] - left[1]),
    ),
    nonJobs: rows.filter((row) => isNonJobTitle(row.title)).length,
    personas: metrics,
    pool,
    recordedJobs: records.length,
    storedJobs,
    wrongField,
    wrongFieldRate: pool === 0 ? 0 : wrongField / pool,
  } satisfies FilterProofResult;
}

const recordedJobSchema = z
  .object({
    company: z.string(),
    external_id: z.string(),
    public_slug: z.string(),
    source: z.string(),
    title: z.string(),
  })
  .loose();

function isRecordedJob(value: unknown): value is FreehireJobRecord {
  return recordedJobSchema.safeParse(value).success;
}

/**
 * Loads the committed freehire pull fixture. The file is gzipped because the pull is about 8,000 real records; no
 * test or CI job ever calls freehire itself.
 * @param path The fixture path, relative to the repository root.
 * @returns The recorded jobs.
 */
export function loadRecordedPull(path: string) {
  const parsed: unknown = JSON.parse(
    gunzipSync(readFileSync(new URL(`../../../${path}`, import.meta.url))).toString("utf8"),
  );

  if (!Array.isArray(parsed)) {
    throw new TypeError(`${path} is not an array of freehire jobs`);
  }

  return parsed.filter((job) => isRecordedJob(job));
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)} %`;
}

/**
 * The markdown report for a filter-proof run.
 * @param result The metrics.
 * @returns A report ready for `docs/research/`.
 */
export function filterProofMarkdown(result: FilterProofResult) {
  const lines = [
    "# Filter proof on a recorded freehire pull (issue #685)",
    "",
    `Generated ${result.generatedAt} by \`bun run scripts/filter-proof.ts\`. The input is a recorded freehire`,
    "pull committed at `src/server/jobs/fixtures/filter-proof/freehire-pull-2026-11-26.json.gz` (28 sendable",
    "sources, open jobs only, descriptions trimmed to 4,000 characters). No test, CI job or scheduled job calls",
    "freehire or any other paid service.",
    "",
    `- recorded jobs: **${String(result.recordedJobs)}**`,
    `- jobs stored by the production store: **${String(result.storedJobs)}** (deduplicated by employer, title and places)`,
    `- non-job titles the store kept for audit but every pool hides: **${String(result.nonJobs)}**`,
    `- detected posting languages: ${Object.entries(result.languages)
      .map(([language, count]) => `${language} ${String(count)}`)
      .join(", ")}`,
    `- people measured: **${String(result.personas.length)}** (12 graded fields, King Kong, 3 walk users)`,
    `- overall wrong-field rate: **${percent(result.wrongFieldRate)}** (${String(result.wrongField)} of ${String(result.pool)} pooled rows; target ≤ 3 %)`,
    `- acceptance: wrong-field ≤ 3 % — **${result.wrongFieldRate <= 0.03 ? "pass" : "fail"}**`,
    "",
    "Wrong-field means the pooled row is outside the person's field: its freehire category is not in the field and",
    "its title does not name the field. It is graded independently of the filter's own category and title-word",
    "choices. Missed-right means a job that is in the field, in the person's places, in a language they read and is",
    "a real job, but the production matching pool did not return it.",
    "",
    "| Person | Group | Pool | Wrong field | Wrong-field rate | Wrong place | Right jobs | Missed right | Missed-right rate | Title-only matches | Title-only, no category | Title-only, other |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...result.personas.map(
      (persona) =>
        `| ${persona.name} | ${persona.group} | ${String(persona.pool)} | ${String(persona.wrongField)} | ${percent(persona.wrongFieldRate)} | ${String(persona.locationWrong)} | ${String(persona.rightJobs)} | ${String(persona.missedRight)} | ${percent(persona.missedRightRate)} | ${String(persona.titleOnly)} | ${String(persona.titleOnlyNullCategory)} | ${String(persona.titleOnlyOtherCategory)} |`,
    ),
    "",
    `- Title-only matches with no freehire category: **${String(result.personas.reduce((sum, persona) => sum + persona.titleOnlyNullCategory, 0))}**;`,
    `  with freehire's fallback category \`other\`: **${String(result.personas.reduce((sum, persona) => sum + persona.titleOnlyOtherCategory, 0))}**.`,
    "",
    "## What the numbers show",
    "",
    "- The wrong-field rate is the share of the pooled rows that the independent field grade rejects.",
    "- A title-only match is a pooled row whose freehire category was not among the person's picked categories, so",
    "  only a picked title word let it in. `no category` is the subset where freehire sent no category at all; in",
    "  this pull freehire sent `other` rather than null, so the null count is near zero and `other` is the real",
    "  bucket to read.",
    "- Missed-right is the recall cost of the code filter. The AI never sees these jobs; if the number is high for a",
    "  field, that field's title words or categories need widening.",
    "",
    "### Method",
    "",
    "- The pull was recorded once on 2026-11-26 with the 28 freehire sources Overture can send to, open jobs only,",
    "  sort `created_at` descending, and descriptions trimmed to 4,000 characters. It contains no live request.",
    "- Every row is written through the production store (so dedupe, category, place facets and language detection",
    "  are the runtime code) and read through the production matching pool (`matching/jobs-pool.ts`, the code the",
    "  scorer and Matches page use) with each persona's categories, title words, place ids and spoken languages.",
    "- Grading is independent on the title side: a row is in the person's field when its freehire category is one",
    "  they picked or its title matches the field's role titles. The filter's own title words are never used to",
    "  grade a pool.",
    "- A right job must be in the person's places, in a language they read, and not a talent pool, open",
    "  application or test row. Non-English rows are therefore not counted as missed for an English-only person.",
    "",
    "### Limits",
    "",
    "- freehire filled `enrichment.category` on every recorded row, so the `category: null` column is 0; freehire's",
    "  fallback `other` is the meaningful bucket for a title-only match. The pool and its unit tests cover the",
    "  null case even though this pull did not contain one.",
    "- Language detection needs 200 Latin characters for a Latin language, so a short non-English row can stay",
    "  `undetected` and pass; that is deliberate, because a wrong guess is worse than showing the row to the AI.",
    "- The place proof is the exact place-id intersection from #683; a remote country matches only a posting",
    "  freehire marks remote. The wrong-place column is therefore an end-to-end check, not a separate metric.",
    "",
    "## How to re-run",
    "",
    "```sh",
    "bun run scripts/filter-proof.ts",
    "```",
    "",
    "The command reads the committed pull, runs the production store and matching pool in an in-memory database, prints the",
    "table above and rewrites this file. It makes no network request.",
    "",
  ];

  return lines.join("\n");
}
