/**
 * The applicant tracking systems Overture ingests. Shared by the catalog and application schemas.
 *
 * The registry is the approved Stapply no-login board set (issue #563): the five boards Overture already
 * applies to, Wave 1A's pure guest-apply boards, and Wave 1B's boards whose employer may gate the form
 * behind a login. A board's wave says where its feed came from; `applySupported` says whether Overture has
 * a deterministic apply adapter for it, which is the five shipped adapters plus the Wave 1A batches that
 * have shipped their form readers and browser adapters.
 */
export const SHIPPED_ATS = ["greenhouse", "lever", "ashby", "workable", "personio"] as const;

export const WAVE_1A_ATS = [
  "smartrecruiters",
  "manatal",
  "careerplug",
  "jazzhr",
  "teamtailor",
  "zoho_recruit",
  "bamboohr",
  "recruitee",
  "hireology",
  "breezy",
  "softgarden",
  "clearcompany",
  "join_com",
  "pinpoint",
  "hiringthing",
  "rippling",
  "gem",
] as const;

export const WAVE_1B_ATS = [
  "paylocity",
  "isolved_hire",
  "applicantpro",
  "catsone",
  "onlyfy",
  "varbi",
] as const;

/** The Batch 3 Wave 1A boards whose deterministic adapters and form readers ship in issue #569. */
export const BATCH_3_ATS = [
  "breezy",
  "softgarden",
  "clearcompany",
  "join_com",
  "pinpoint",
] as const;

/** The apply-supported boards whose form plan is cached by signature (every board but Greenhouse). */
export const PLAN_CACHE_ATS = ["lever", "ashby", "workable", "personio", ...BATCH_3_ATS] as const;

export const ATS_VALUES = [...SHIPPED_ATS, ...WAVE_1A_ATS, ...WAVE_1B_ATS] as const;

export type Ats = (typeof ATS_VALUES)[number];

export type ShippedAts = (typeof SHIPPED_ATS)[number];

export type BatchThreeAts = (typeof BATCH_3_ATS)[number];

/** Every board with a deterministic apply adapter, in registry order. */
export type ApplySupportedAts = ShippedAts | BatchThreeAts;

export type AtsWave = "shipped" | "wave1a" | "wave1b";

export interface AtsRegistryEntry {
  /** The wave that brought the board's feed in. */
  wave: AtsWave;
  /** Whether Overture has a deterministic apply adapter for the board. */
  applySupported: boolean;
}

export const ATS_REGISTRY = {
  greenhouse: { applySupported: true, wave: "shipped" },
  lever: { applySupported: true, wave: "shipped" },
  ashby: { applySupported: true, wave: "shipped" },
  workable: { applySupported: true, wave: "shipped" },
  personio: { applySupported: true, wave: "shipped" },
  smartrecruiters: { applySupported: false, wave: "wave1a" },
  manatal: { applySupported: false, wave: "wave1a" },
  careerplug: { applySupported: false, wave: "wave1a" },
  jazzhr: { applySupported: false, wave: "wave1a" },
  teamtailor: { applySupported: false, wave: "wave1a" },
  zoho_recruit: { applySupported: false, wave: "wave1a" },
  bamboohr: { applySupported: false, wave: "wave1a" },
  recruitee: { applySupported: false, wave: "wave1a" },
  hireology: { applySupported: false, wave: "wave1a" },
  breezy: { applySupported: true, wave: "wave1a" },
  softgarden: { applySupported: true, wave: "wave1a" },
  clearcompany: { applySupported: true, wave: "wave1a" },
  join_com: { applySupported: true, wave: "wave1a" },
  pinpoint: { applySupported: true, wave: "wave1a" },
  hiringthing: { applySupported: false, wave: "wave1a" },
  rippling: { applySupported: false, wave: "wave1a" },
  gem: { applySupported: false, wave: "wave1a" },
  paylocity: { applySupported: false, wave: "wave1b" },
  isolved_hire: { applySupported: false, wave: "wave1b" },
  applicantpro: { applySupported: false, wave: "wave1b" },
  catsone: { applySupported: false, wave: "wave1b" },
  onlyfy: { applySupported: false, wave: "wave1b" },
  varbi: { applySupported: false, wave: "wave1b" },
} as const satisfies Record<Ats, AtsRegistryEntry>;

/**
 * The ATS boards with a deterministic apply adapter: the five shipped boards and Batch 3's five Wave 1A
 * boards. Every other board's postings are ingest-only and never match a user.
 */
export const APPLY_SUPPORTED_ATS = [...SHIPPED_ATS, ...BATCH_3_ATS] as const;

/**
 * Whether Overture can apply to a board through a deterministic adapter.
 * @param ats The board's ATS value.
 * @returns True for the shipped adapters and the Wave 1A batches that have shipped.
 */
export function isApplySupportedAts(ats: string): ats is ApplySupportedAts {
  return APPLY_SUPPORTED_ATS.some((candidate) => candidate === ats);
}
