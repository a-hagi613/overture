import { z } from "zod";

export const ROLE_GROUPS = [
  "Software Engineering",
  "Data & Analytics",
  "Machine Learning & AI",
  "Product Management",
  "Design",
  "DevOps & Infrastructure",
  "Security",
  "IT & Support Engineering",
  "QA & Test",
  "Hardware & Embedded",
  "Sales",
  "Customer Success",
  "Customer Support",
  "Marketing",
  "Communications & PR",
  "Finance",
  "Accounting",
  "Legal",
  "People & HR",
  "Recruiting",
  "Operations",
  "Supply Chain & Logistics",
  "Project & Program Management",
  "Business Development & Partnerships",
  "Healthcare",
  "Education",
  "Research & Science",
  "Administrative",
] as const;

export type RoleGroup = (typeof ROLE_GROUPS)[number];

export const SUBROLES = [
  "Frontend",
  "Backend",
  "Full-stack",
  "Mobile",
  "Platform",
  "Embedded",
] as const;

export type Subrole = (typeof SUBROLES)[number];

export const SENIORITIES = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
] as const;

export type Seniority = (typeof SENIORITIES)[number];

export const WORKPLACES = ["remote", "hybrid", "onsite", "unknown"] as const;

export type Workplace = (typeof WORKPLACES)[number];

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "internship",
  "temporary",
  "unknown",
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SALARY_PERIODS = ["year", "month", "week", "hour", "day"] as const;

export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const TAG_SOURCES = ["rules", "model", "llm", "import"] as const;

export type TagSource = (typeof TAG_SOURCES)[number];

export const salaryRangeSchema = z.object({
  currency: z.string().min(3).max(8).nullable(),
  minMinor: z.number().int().nonnegative().nullable(),
  maxMinor: z.number().int().nonnegative().nullable(),
  period: z.enum(SALARY_PERIODS).nullable(),
});

export type SalaryRange = z.infer<typeof salaryRangeSchema>;

export const locationSchema = z.object({
  countryCode: z.string().length(2).nullable(),
  region: z.string().max(120).nullable(),
  city: z.string().max(120).nullable(),
});

export type Location = z.infer<typeof locationSchema>;

export const postingTagInputSchema = z.object({
  title: z.string().min(1),
  department: z.string().max(200).nullable().default(null),
  locationRaw: z.string().max(400).nullable().default(null),
  workplaceType: z.string().max(40).nullable().default(null),
  isRemote: z.boolean().nullable().default(null),
  employmentType: z.string().max(60).nullable().default(null),
  language: z.string().min(2).max(5).nullable().default(null),
  salary: salaryRangeSchema.nullable().default(null),
  descriptionText: z.string().max(20_000).nullable().default(null),
});

export type PostingTagInput = z.input<typeof postingTagInputSchema>;

export const postingTagsSchema = z.object({
  workplace: z.enum(WORKPLACES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  countryCode: z.string().length(2).nullable(),
  region: z.string().max(120).nullable(),
  city: z.string().max(120).nullable(),
  language: z.string().min(2).max(5).nullable(),
  salaryMinMinor: z.number().int().nonnegative().nullable(),
  salaryMaxMinor: z.number().int().nonnegative().nullable(),
  salaryCurrency: z.string().min(3).max(8).nullable(),
  salaryPeriod: z.enum(SALARY_PERIODS).nullable(),
  role: z.string().max(60).nullable(),
  subrole: z.string().max(40).nullable(),
  seniority: z.enum(SENIORITIES).nullable(),
  roleSource: z.enum(["rules", "model", "unclassified"]),
});

export type PostingTags = z.infer<typeof postingTagsSchema>;
