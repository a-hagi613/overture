export const TIER_1_FACT_KEYS = [
  "legal_name",
  "email",
  "phone",
  "current_city",
  "current_country",
  "linkedin_url",
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

export type FactKey = (typeof FACT_KEYS)[number];

export const factLabels: Record<FactKey, string> = {
  legal_name: "Legal name",
  email: "Job-search email",
  phone: "Phone",
  current_city: "City",
  current_country: "Country",
  linkedin_url: "LinkedIn",
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

export const factSources = {
  resume: "from your resume",
  user: "you entered",
  review: "from a question you answered",
  import: "imported",
} as const;
