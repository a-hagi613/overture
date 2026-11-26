import type { Ats } from "./ats.ts";

/**
 * The freehire `source` values Overture has a sender for, mapped to the ATS name the rest of the app uses.
 * A source outside this map is not pullable, because nothing could ever fill its form.
 */
export const FREEHIRE_SOURCE_TO_ATS = {
  greenhouse: "greenhouse",
  lever: "lever",
  ashby: "ashby",
  workable: "workable",
  personio: "personio",
  smartrecruiters: "smartrecruiters",
  manatal: "manatal",
  careerplug: "careerplug",
  jazzhr: "jazzhr",
  teamtailor: "teamtailor",
  zohorecruit: "zoho_recruit",
  bamboohr: "bamboohr",
  recruitee: "recruitee",
  hireology: "hireology",
  breezy: "breezy",
  softgarden: "softgarden",
  join: "join_com",
  pinpoint: "pinpoint",
  hiringthing: "hiringthing",
  rippling: "rippling",
  gem: "gem",
  paylocity: "paylocity",
  isolvedhire: "isolved_hire",
  applicantpro: "applicantpro",
  catsone: "catsone",
  onlyfy: "onlyfy",
  jobvite: "jobvite",
  herp: "herp",
} as const satisfies Record<string, Ats>;

export type FreehireSource = keyof typeof FREEHIRE_SOURCE_TO_ATS;

/** Every freehire source with a sender, in mapping order. The pull sends these as one comma-separated filter. */
export const FREEHIRE_SOURCES: FreehireSource[] = Object.keys(FREEHIRE_SOURCE_TO_ATS).filter(
  (source): source is FreehireSource => source in FREEHIRE_SOURCE_TO_ATS,
);

const ATS_BY_FREEHIRE_SOURCE = new Map<string, Ats>(Object.entries(FREEHIRE_SOURCE_TO_ATS));

export const FREEHIRE_WORK_MODES = ["remote", "hybrid", "onsite"] as const;

export type FreehireWorkMode = (typeof FREEHIRE_WORK_MODES)[number];

export const FREEHIRE_SENIORITIES = [
  "intern",
  "junior",
  "middle",
  "senior",
  "lead",
  "staff",
  "principal",
  "c_level",
] as const;

export type FreehireSeniority = (typeof FREEHIRE_SENIORITIES)[number];

/** One freehire search result, exactly as `/jobs/search` and `/jobs/{slug}` send it. */
export interface FreehireJobRecord {
  public_slug: string;
  source: string;
  external_id: string;
  title: string;
  company: string;
  company_slug: string | null;
  url: string | null;
  apply_url: string | null;
  location: string | null;
  description: string | null;
  countries: string[] | null;
  regions: string[] | null;
  metros: string[] | null;
  cities: string[] | null;
  work_mode: FreehireWorkMode | null;
  skills: string[] | null;
  posted_at: string | null;
  created_at: string | null;
  updated_at?: string | null;
  closed_at: string | null;
  enrichment: {
    category?: string | null;
    seniority?: string | null;
    employment_type?: string | null;
    experience_years_min?: number | null;
    salary_min?: number | null;
    salary_max?: number | null;
    salary_currency?: string | null;
    salary_period?: string | null;
    visa_sponsorship?: boolean | null;
  } | null;
  reality: {
    class?: string | null;
    age_days?: number | null;
    repost_count?: number | null;
    fake_freshness?: boolean | null;
  } | null;
}

/**
 * The ATS a freehire source maps to.
 * @param source The freehire source name.
 * @returns The ATS value, or null when Overture has no sender for it.
 */
export function atsForFreehireSource(source: string) {
  return ATS_BY_FREEHIRE_SOURCE.get(source) ?? null;
}

/**
 * The board token freehire packs before the colon of `external_id`; senders need the employer's real board.
 * @param externalId freehire's `<board>:<job id>` id.
 * @returns The board token, or an empty string when freehire sent no colon.
 */
export function boardTokenOf(externalId: string) {
  const split = externalId.indexOf(":");

  return split === -1 ? "" : externalId.slice(0, split);
}

/**
 * The employer's own job id from freehire's `external_id`.
 * @param externalId freehire's `<board>:<job id>` id.
 * @returns The id after the colon, or the whole value when freehire sent no colon.
 */
export function atsJobIdOf(externalId: string) {
  const split = externalId.indexOf(":");

  return split === -1 ? externalId : externalId.slice(split + 1);
}

/**
 * A freehire work mode, or null when the field is blank or holds a value Overture does not know. Work mode is never
 * guessed: freehire leaves it out on most postings, and the matching rules treat null as "not stated".
 * @param value The raw `work_mode` from freehire.
 * @returns The known mode, or null.
 */
export const freehireWorkMode: (value: string | null | undefined) => FreehireWorkMode | null = (
  value,
) => (value === "remote" || value === "hybrid" || value === "onsite" ? value : null);

/**
 * Milliseconds for a freehire timestamp.
 * @param value An ISO timestamp, or null/blank.
 * @returns The epoch milliseconds, or null when the value is missing or invalid.
 */
export function timestampOf(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Cheap, stable freehire job key: its public slug, which is unique across the catalogue.
 * @param job A freehire search result.
 * @returns The job's public slug.
 */
export function freehireJobId(job: FreehireJobRecord) {
  return job.public_slug;
}
