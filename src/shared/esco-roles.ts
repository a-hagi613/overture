import type { RoleGroup } from "./tag-taxonomy.ts";

/**
 * One Level-2 role from the baked ESCO dataset and the Level-1 category it rolls up to (WS-17a/WS-17b).
 *
 * This list is the compact projection the browser may load: 134 role names and their categories, roughly 8 KB of
 * source, instead of the 2,942-occupation synonym table the retired classifier used (8.3 MB, deleted by #706).
 */
export interface EscoRoleOption {
  readonly category: RoleGroup;
  readonly role: string;
}

/**
 * Every Level-2 role the ESCO dataset records, in `ROLE_GROUPS` order then alphabetical. A role equal to its
 * category is the dataset's fallback when no granular rule matched; it is kept here because a catalog can tag a
 * Posting with it, but the pickers hide those duplicates and offer the category itself instead.
 */
export const ESCO_ROLE_OPTIONS: readonly EscoRoleOption[] = [
  { category: "Software Engineering", role: "Frontend Engineer" },
  { category: "Software Engineering", role: "Game Developer" },
  { category: "Software Engineering", role: "Software Architect" },
  { category: "Software Engineering", role: "Software Engineer" },
  { category: "Software Engineering", role: "Software Engineering" },
  { category: "Data & Analytics", role: "Data & Analytics" },
  { category: "Data & Analytics", role: "Data Analyst" },
  { category: "Data & Analytics", role: "Data Engineer" },
  { category: "Data & Analytics", role: "Data Scientist" },
  { category: "Data & Analytics", role: "Statistician" },
  { category: "Machine Learning & AI", role: "AI Research Scientist" },
  { category: "Product Management", role: "Product Manager" },
  { category: "Design", role: "Design" },
  { category: "Design", role: "Design Manager" },
  { category: "Design", role: "Fashion Designer" },
  { category: "Design", role: "Graphic Designer" },
  { category: "Design", role: "Industrial Designer" },
  { category: "Design", role: "Interior Designer" },
  { category: "Design", role: "Motion Designer" },
  { category: "Design", role: "UI Designer" },
  { category: "Design", role: "UX Researcher" },
  { category: "DevOps & Infrastructure", role: "Database Administrator" },
  { category: "DevOps & Infrastructure", role: "DevOps & Infrastructure" },
  { category: "DevOps & Infrastructure", role: "Network Engineer" },
  { category: "Security", role: "Firefighter" },
  { category: "Security", role: "Police Officer" },
  { category: "Security", role: "Security" },
  { category: "Security", role: "Security Engineer" },
  { category: "Security", role: "Security Guard" },
  { category: "Security", role: "Soldier" },
  { category: "IT & Support Engineering", role: "IT & Support Engineering" },
  { category: "IT & Support Engineering", role: "IT Support Specialist" },
  { category: "IT & Support Engineering", role: "Systems Administrator" },
  { category: "QA & Test", role: "QA Engineer" },
  { category: "QA & Test", role: "Quality Manager" },
  { category: "Hardware & Embedded", role: "Hardware & Embedded" },
  { category: "Hardware & Embedded", role: "Hardware Engineer" },
  { category: "Sales", role: "Account Manager" },
  { category: "Sales", role: "Real Estate Agent" },
  { category: "Sales", role: "Sales" },
  { category: "Sales", role: "Sales Manager" },
  { category: "Sales", role: "Sales Representative" },
  { category: "Sales", role: "Solutions Engineer" },
  { category: "Customer Success", role: "Client Relationship Manager" },
  { category: "Customer Success", role: "Community Manager" },
  { category: "Customer Support", role: "Customer Support Specialist" },
  { category: "Marketing", role: "Content Marketer" },
  { category: "Marketing", role: "Events Manager" },
  { category: "Marketing", role: "Marketing" },
  { category: "Marketing", role: "Marketing Analyst" },
  { category: "Marketing", role: "Marketing Manager" },
  { category: "Communications & PR", role: "Communications & PR" },
  { category: "Communications & PR", role: "Copywriter" },
  { category: "Communications & PR", role: "Editor" },
  { category: "Communications & PR", role: "Public Relations Manager" },
  { category: "Communications & PR", role: "Technical Writer" },
  { category: "Communications & PR", role: "Translator" },
  { category: "Finance", role: "Credit Analyst" },
  { category: "Finance", role: "Economist" },
  { category: "Finance", role: "Finance" },
  { category: "Finance", role: "Financial Analyst" },
  { category: "Finance", role: "Financial Controller" },
  { category: "Finance", role: "Financial Planner" },
  { category: "Finance", role: "Insurance Agent" },
  { category: "Finance", role: "Risk Manager" },
  { category: "Finance", role: "Tax Advisor" },
  { category: "Accounting", role: "Accountant" },
  { category: "Accounting", role: "Auditor" },
  { category: "Legal", role: "Compliance Officer" },
  { category: "Legal", role: "Judge" },
  { category: "Legal", role: "Lawyer" },
  { category: "Legal", role: "Legal" },
  { category: "Legal", role: "Paralegal" },
  { category: "People & HR", role: "HR Manager" },
  { category: "People & HR", role: "HR Specialist" },
  { category: "People & HR", role: "People & HR" },
  { category: "People & HR", role: "Training Manager" },
  { category: "Recruiting", role: "Recruiter" },
  { category: "Operations", role: "Chef" },
  { category: "Operations", role: "Cleaner" },
  { category: "Operations", role: "Construction Worker" },
  { category: "Operations", role: "Facilities Manager" },
  { category: "Operations", role: "Farmer" },
  { category: "Operations", role: "Flight Attendant" },
  { category: "Operations", role: "Health and Safety Officer" },
  { category: "Operations", role: "Hotel Manager" },
  { category: "Operations", role: "Machine Operator" },
  { category: "Operations", role: "Operations" },
  { category: "Operations", role: "Operations Manager" },
  { category: "Operations", role: "Production Manager" },
  { category: "Supply Chain & Logistics", role: "Delivery Driver" },
  { category: "Supply Chain & Logistics", role: "Logistician" },
  { category: "Supply Chain & Logistics", role: "Procurement Specialist" },
  { category: "Supply Chain & Logistics", role: "Supply Chain & Logistics" },
  { category: "Supply Chain & Logistics", role: "Supply Chain Manager" },
  { category: "Supply Chain & Logistics", role: "Warehouse Manager" },
  { category: "Project & Program Management", role: "Project Manager" },
  { category: "Project & Program Management", role: "Technical Program Manager" },
  { category: "Business Development & Partnerships", role: "Business Development Manager" },
  { category: "Business Development & Partnerships", role: "Partnership Manager" },
  { category: "Healthcare", role: "Dentist" },
  { category: "Healthcare", role: "Healthcare" },
  { category: "Healthcare", role: "Medical Assistant" },
  { category: "Healthcare", role: "Medical Laboratory Technician" },
  { category: "Healthcare", role: "Midwife" },
  { category: "Healthcare", role: "Pharmacist" },
  { category: "Healthcare", role: "Physician" },
  { category: "Healthcare", role: "Physiotherapist" },
  { category: "Healthcare", role: "Psychologist" },
  { category: "Healthcare", role: "Registered Nurse" },
  { category: "Healthcare", role: "Social Worker" },
  { category: "Healthcare", role: "Veterinarian" },
  { category: "Education", role: "Education" },
  { category: "Education", role: "Education Manager" },
  { category: "Education", role: "Instructional Designer" },
  { category: "Education", role: "Librarian" },
  { category: "Education", role: "Teacher" },
  { category: "Research & Science", role: "Biologist" },
  { category: "Research & Science", role: "Chemist" },
  { category: "Research & Science", role: "Environmental Scientist" },
  { category: "Research & Science", role: "Geologist" },
  { category: "Research & Science", role: "Mathematician" },
  { category: "Research & Science", role: "Physicist" },
  { category: "Research & Science", role: "Research & Science" },
  { category: "Research & Science", role: "Research Scientist" },
  { category: "Research & Science", role: "Social Scientist" },
  { category: "Administrative", role: "Administrative" },
  { category: "Administrative", role: "Administrative Assistant" },
  { category: "Administrative", role: "Data Entry Clerk" },
  { category: "Administrative", role: "Executive Assistant" },
  { category: "Administrative", role: "Office Clerk" },
  { category: "Administrative", role: "Office Manager" },
  { category: "Administrative", role: "Receptionist" },
  { category: "Administrative", role: "Secretary" },
];

/** Every Level-2 role name the dataset records, unique and sorted, for a closed query enum. */
export const ESCO_ROLE_NAMES: readonly string[] = [
  ...new Set(ESCO_ROLE_OPTIONS.map((option) => option.role)),
].toSorted((left, right) => left.localeCompare(right, "en"));

const ROLE_NAME_SET = new Set(ESCO_ROLE_NAMES);

/**
 * @param value A query or stored target string.
 * @returns True when it is one of the 134 baked ESCO Level-2 role names.
 */
export function isEscoRole(value: string) {
  return ROLE_NAME_SET.has(value);
}
