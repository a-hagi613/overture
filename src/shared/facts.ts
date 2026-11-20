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

export type Tier1FactKey = (typeof TIER_1_FACT_KEYS)[number];

export const factLabels: Record<Tier1FactKey, string> = {
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
};

export const factSources = {
  resume: "from your resume",
  user: "you entered",
  review: "from a question you answered",
  import: "imported",
} as const;
