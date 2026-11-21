export const TIER_1_FACT_KEYS = [
  "legal_name",
  "email",
  "phone",
  "current_city",
  "current_country",
  "linkedin_url",
  "current_job_title",
  "work_auth",
  "sponsorship_required",
  "notice_period",
  "earliest_start",
  "salary_expectation",
  "willing_relocate",
  "years_total",
  "degree_highest",
  "employment_history",
  "education_history",
  "current_employer",
  "how_did_you_hear",
  "languages",
] as const;

export const TIER_2_FACT_KEYS = [
  "preferred_name",
  "github_url",
  "website_url",
  "skills",
  "certifications",
  "security_clearance",
  "drivers_license",
  "spoken_languages_levels",
  "voice_sample",
  "cover_letter_template",
  "eeo_gender",
  "eeo_race_ethnicity",
  "eeo_hispanic_latino",
  "eeo_veteran",
  "eeo_disability",
] as const;

export const FACT_KEYS = [...TIER_1_FACT_KEYS, ...TIER_2_FACT_KEYS] as const;

export type Tier1FactKey = (typeof TIER_1_FACT_KEYS)[number];

export type Tier2FactKey = (typeof TIER_2_FACT_KEYS)[number];

export function isTier2FactKey(key: string): key is Tier2FactKey {
  return TIER_2_FACT_KEYS.some((candidate) => candidate === key);
}

export type FactKey = (typeof FACT_KEYS)[number];

export const COUNTRY_SCOPED_FACT_KEYS = ["work_auth", "sponsorship_required"] as const;

export type CountryScopedFactKey = (typeof COUNTRY_SCOPED_FACT_KEYS)[number];

export function isCountryScopedFactKey(key: string): key is CountryScopedFactKey {
  return COUNTRY_SCOPED_FACT_KEYS.some((candidate) => candidate === key);
}

/** Facts kept once per currency, because a form asks for its own currency. */
export const CURRENCY_SCOPED_FACT_KEYS = ["salary_expectation"] as const;

export type CurrencyScopedFactKey = (typeof CURRENCY_SCOPED_FACT_KEYS)[number];

export function isCurrencyScopedFactKey(key: string): key is CurrencyScopedFactKey {
  return CURRENCY_SCOPED_FACT_KEYS.some((candidate) => candidate === key);
}

export function isCurrencyCode(code: string) {
  return /^[A-Z]{3}$/u.test(code);
}

/** The Tier 1 questions the onboarding "Your facts" step asks. */
export const ONBOARDING_QUESTION_FACT_KEYS = {
  jobTitle: "current_job_title",
  workAuth: "work_auth",
  salary: "salary_expectation",
  hear: "how_did_you_hear",
  eeo: ["eeo_gender", "eeo_race_ethnicity", "eeo_veteran", "eeo_disability"],
} as const;

export const factLabels: Record<FactKey, string> = {
  legal_name: "Legal name",
  email: "Job-search email",
  phone: "Phone",
  current_city: "City",
  current_country: "Country",
  linkedin_url: "LinkedIn",
  current_job_title: "Current job title",
  work_auth: "Work authorisation",
  sponsorship_required: "Sponsorship",
  notice_period: "Notice period",
  earliest_start: "Earliest start",
  salary_expectation: "Salary expectation",
  willing_relocate: "Willing to relocate",
  years_total: "Total years of experience",
  degree_highest: "Highest degree",
  employment_history: "Employment history",
  education_history: "Education",
  current_employer: "Current employer",
  how_did_you_hear: "How you heard about us",
  languages: "Languages",
  preferred_name: "Preferred name",
  github_url: "GitHub",
  website_url: "Website",
  skills: "Skills",
  certifications: "Certifications",
  security_clearance: "Security clearance",
  drivers_license: "Driver's licence",
  spoken_languages_levels: "Spoken languages and levels",
  voice_sample: "Voice sample",
  cover_letter_template: "Cover-letter template",
  eeo_gender: "Gender",
  eeo_race_ethnicity: "Race and ethnicity",
  eeo_hispanic_latino: "Hispanic or Latino",
  eeo_veteran: "Veteran status",
  eeo_disability: "Disability",
};

const factLabelByKey = new Map<string, string>(FACT_KEYS.map((key) => [key, factLabels[key]]));

export function factLabelFor(key: string) {
  return factLabelByKey.get(key) ?? null;
}

export const factSources = {
  resume: "from your resume",
  user: "you entered",
  review: "from a question you answered",
  import: "imported",
} as const;
