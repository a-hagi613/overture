/**
 * The applicant tracking systems Overture ingests. Shared by the catalog and application schemas.
 *
 * The registry is the approved Stapply no-login board set (issue #563): the five boards Overture already
 * applies to, Wave 1A's pure guest-apply boards, and Wave 1B's boards whose employer may gate the form
 * behind a login. A board's wave says where its feed came from; `applySupported` says whether Overture has
 * a deterministic apply adapter for it, which is the five shipped adapters plus every wave's batches that
 * have shipped their form readers and browser adapters (issues #572, #571, #569 and #574).
 */
export const SHIPPED_ATS = ["greenhouse", "lever", "ashby", "workable", "personio"] as const;

/** Batch 1 of the wave adapters (WS-2c, issue #572). */
export const BATCH_1_ATS = [
  "smartrecruiters",
  "paylocity",
  "manatal",
  "careerplug",
  "jazzhr",
] as const;

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

/** The Batch 2 Wave 1A boards whose deterministic adapters and form readers ship in issue #571. */
export const BATCH_2_ATS = [
  "teamtailor",
  "zoho_recruit",
  "bamboohr",
  "recruitee",
  "hireology",
] as const;

/** The Batch 3 Wave 1A boards whose deterministic adapters and form readers ship in issue #569. */
export const BATCH_3_ATS = [
  "breezy",
  "softgarden",
  "clearcompany",
  "join_com",
  "pinpoint",
] as const;

/** The Batch 4 Wave 1A and Wave 1B boards whose deterministic adapters ship in issue #574. */
export const BATCH_4_ATS = [
  "hiringthing",
  "rippling",
  "gem",
  "isolved_hire",
  "applicantpro",
  "catsone",
  "onlyfy",
  "varbi",
] as const;

/** The apply-supported boards whose form plan is cached by signature (every board but Greenhouse). */
export const PLAN_CACHE_ATS = [
  "lever",
  "ashby",
  "workable",
  "personio",
  ...BATCH_1_ATS,
  ...BATCH_2_ATS,
  ...BATCH_3_ATS,
  ...BATCH_4_ATS,
] as const;

export const ATS_VALUES = [...SHIPPED_ATS, ...WAVE_1A_ATS, ...WAVE_1B_ATS] as const;

export type Ats = (typeof ATS_VALUES)[number];

export type ShippedAts = (typeof SHIPPED_ATS)[number];

export type BatchOneAts = (typeof BATCH_1_ATS)[number];

export type BatchTwoAts = (typeof BATCH_2_ATS)[number];

export type BatchThreeAts = (typeof BATCH_3_ATS)[number];

export type BatchFourAts = (typeof BATCH_4_ATS)[number];

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
  smartrecruiters: { applySupported: true, wave: "wave1a" },
  manatal: { applySupported: true, wave: "wave1a" },
  careerplug: { applySupported: true, wave: "wave1a" },
  jazzhr: { applySupported: true, wave: "wave1a" },
  teamtailor: { applySupported: true, wave: "wave1a" },
  zoho_recruit: { applySupported: true, wave: "wave1a" },
  bamboohr: { applySupported: true, wave: "wave1a" },
  recruitee: { applySupported: true, wave: "wave1a" },
  hireology: { applySupported: true, wave: "wave1a" },
  breezy: { applySupported: true, wave: "wave1a" },
  softgarden: { applySupported: true, wave: "wave1a" },
  clearcompany: { applySupported: true, wave: "wave1a" },
  join_com: { applySupported: true, wave: "wave1a" },
  pinpoint: { applySupported: true, wave: "wave1a" },
  hiringthing: { applySupported: true, wave: "wave1a" },
  rippling: { applySupported: true, wave: "wave1a" },
  gem: { applySupported: true, wave: "wave1a" },
  paylocity: { applySupported: true, wave: "wave1b" },
  isolved_hire: { applySupported: true, wave: "wave1b" },
  applicantpro: { applySupported: true, wave: "wave1b" },
  catsone: { applySupported: true, wave: "wave1b" },
  onlyfy: { applySupported: true, wave: "wave1b" },
  varbi: { applySupported: true, wave: "wave1b" },
} as const satisfies Record<Ats, AtsRegistryEntry>;

/**
 * The ATS boards with a deterministic apply adapter: the five shipped boards and every batch that has
 * shipped its form readers and browser adapters. Every other board's postings are ingest-only and never
 * match a user.
 */
export const APPLY_SUPPORTED_ATS = [
  ...SHIPPED_ATS,
  ...BATCH_1_ATS,
  ...BATCH_2_ATS,
  ...BATCH_3_ATS,
  ...BATCH_4_ATS,
] as const;

/** Every board with a deterministic apply adapter, in registry order. */
export type ApplySupportedAts = (typeof APPLY_SUPPORTED_ATS)[number];

/**
 * Whether Overture can apply to a board through a deterministic adapter.
 * @param ats The board's ATS value.
 * @returns True for the shipped adapters and every batch that has shipped.
 */
export function isApplySupportedAts(ats: string): ats is ApplySupportedAts {
  return APPLY_SUPPORTED_ATS.some((candidate) => candidate === ats);
}

/**
 * Whether the board's application form is read over plain HTTP and then filled by
 * the Batch 1 hosted-form adapter (WS-2c).
 *
 * @param ats The board's ATS value.
 * @returns True for the Batch 1 boards.
 */
export function isBatch1Ats(ats: string): ats is BatchOneAts {
  return BATCH_1_ATS.some((candidate) => candidate === ats);
}

/**
 * Whether a board belongs to Batch 4, whose hosted forms share one reader and browser adapter.
 *
 * @param ats The board's ATS value.
 * @returns True for Batch 4's boards.
 */
export function isBatchFourAts(ats: string): ats is BatchFourAts {
  return BATCH_4_ATS.some((candidate) => candidate === ats);
}
