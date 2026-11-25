import type { RoleCategoryId } from "../../shared/role-taxonomy.ts";
import type { RoleGroup, Subrole } from "../../shared/tag-taxonomy.ts";

import { ROLE_CATEGORIES, ROLE_SUBCATEGORIES, ROLES } from "../../shared/role-taxonomy.ts";

interface LegacyCategory {
  readonly tag: RoleCategoryId | null;
  readonly target: readonly string[];
}

const LEGACY_CATEGORIES = {
  "Software Engineering": { tag: "software-it", target: ["software-it"] },
  "Data & Analytics": { tag: "data-ai", target: ["data-ai"] },
  "Machine Learning & AI": { tag: "data-ai", target: ["data-ai"] },
  "Product Management": { tag: "product-design", target: ["prod.pm", "prod.owner"] },
  Design: { tag: "product-design", target: ["product-design"] },
  "DevOps & Infrastructure": { tag: "software-it", target: ["software-it"] },
  Security: { tag: null, target: ["it.security", "protective-services"] },
  "IT & Support Engineering": { tag: "software-it", target: ["software-it"] },
  "QA & Test": { tag: "software-it", target: ["sw.qa"] },
  "Hardware & Embedded": { tag: "engineering", target: ["eng.electrical", "sw.embedded"] },
  Sales: { tag: "sales", target: ["sales"] },
  "Customer Success": { tag: "customer-service", target: ["cs.success"] },
  "Customer Support": { tag: "customer-service", target: ["customer-service"] },
  Marketing: { tag: "marketing-communications", target: ["marketing-communications"] },
  "Communications & PR": { tag: "marketing-communications", target: ["marketing-communications"] },
  Finance: { tag: "finance-accounting", target: ["finance-accounting"] },
  Accounting: { tag: "finance-accounting", target: ["finance-accounting"] },
  Legal: { tag: "legal", target: ["legal"] },
  "People & HR": { tag: "people-hr", target: ["people-hr"] },
  Recruiting: { tag: "people-hr", target: ["hr.recruiter"] },
  Operations: { tag: null, target: ["business-operations"] },
  "Supply Chain & Logistics": { tag: "transport-logistics", target: ["transport-logistics"] },
  "Project & Program Management": { tag: "business-operations", target: ["ops.pm", "it.pm"] },
  "Business Development & Partnerships": { tag: "sales", target: ["sales.ae", "sales.am"] },
  Healthcare: { tag: "healthcare", target: ["healthcare"] },
  Education: { tag: "education", target: ["education"] },
  "Research & Science": { tag: "science", target: ["science"] },
  Administrative: { tag: "admin-office", target: ["admin-office"] },
} as const satisfies Record<RoleGroup, LegacyCategory>;

const LEGACY_ROLES = {
  "Frontend Engineer": "sw.frontend",
  "Game Developer": "sw.game",
  "Software Architect": "infra.architect",
  "Software Engineer": "sw.general",
  "Data Analyst": "data.analyst",
  "Data Engineer": "data.engineer",
  "Data Scientist": "data.scientist",
  Statistician: "data.stats",
  "AI Research Scientist": "ml.research",
  "Product Manager": "prod.pm",
  "Design Manager": "design.ux",
  "Fashion Designer": "design.fashion",
  "Graphic Designer": "design.graphic",
  "Industrial Designer": "design.industrial",
  "Interior Designer": "design.interior",
  "Motion Designer": "design.graphic",
  "UI Designer": "design.ux",
  "UX Researcher": "design.ux",
  "Database Administrator": "infra.dba",
  "Network Engineer": "infra.network",
  Firefighter: "sec.fire",
  "Police Officer": "sec.police",
  "Security Engineer": "it.security",
  "Security Guard": "sec.guard",
  Soldier: "mil.military",
  "IT Support Specialist": "it.support",
  "Systems Administrator": "infra.sysadmin",
  "QA Engineer": "sw.qa",
  "Quality Manager": "mgmt.production",
  "Hardware Engineer": "eng.electrical",
  "Account Manager": "sales.am",
  "Real Estate Agent": "sales.realestate",
  "Sales Manager": "sales.manager",
  "Sales Representative": "sales.other",
  "Solutions Engineer": "sales.engineer",
  "Client Relationship Manager": "cs.success",
  "Community Manager": "mkt.pr",
  "Customer Support Specialist": "cs.rep",
  "Content Marketer": "mkt.specialist",
  "Events Manager": "ops.events",
  "Marketing Analyst": "mkt.specialist",
  "Marketing Manager": "mkt.manager",
  Copywriter: "mkt.content",
  Editor: "mkt.content",
  "Public Relations Manager": "mkt.pr",
  "Technical Writer": "media.techwriter",
  Translator: "media.translator",
  "Credit Analyst": "fin.lending",
  Economist: "sci.social",
  "Financial Analyst": "fin.analyst",
  "Financial Controller": "fin.manager",
  "Financial Planner": "fin.advisor",
  "Insurance Agent": "sales.insurance",
  "Risk Manager": "fin.analyst",
  "Tax Advisor": "fin.tax",
  Accountant: "fin.accountant",
  Auditor: "fin.accountant",
  "Compliance Officer": "ops.compliance",
  Judge: "legal.lawyer",
  Lawyer: "legal.lawyer",
  Paralegal: "legal.paralegal",
  "HR Manager": "hr.manager",
  "HR Specialist": "hr.specialist",
  "Training Manager": "edu.trainer",
  Recruiter: "hr.recruiter",
  Chef: "food.chef",
  Cleaner: "clean.janitor",
  "Construction Worker": "trade.laborer",
  "Facilities Manager": "mgmt.facilities",
  Farmer: "agri.farm",
  "Flight Attendant": "trans.cabin",
  "Health and Safety Officer": "hse.specialist",
  "Hotel Manager": "mgmt.lodging",
  "Machine Operator": "mfg.operator",
  "Operations Manager": "mgmt.gm",
  "Production Manager": "mgmt.production",
  "Delivery Driver": "trans.delivery",
  Logistician: "ops.logistics",
  "Procurement Specialist": "ops.buyer",
  "Supply Chain Manager": "mgmt.logistics",
  "Warehouse Manager": "mgmt.logistics",
  "Project Manager": "ops.pm",
  "Technical Program Manager": "it.pm",
  "Business Development Manager": "sales.ae",
  "Partnership Manager": "sales.am",
  Dentist: "health.dentist",
  "Medical Assistant": "care.ma",
  "Medical Laboratory Technician": "health.lab",
  Midwife: "health.np",
  Pharmacist: "health.pharmacist",
  Physician: "health.physician",
  Physiotherapist: "health.pt",
  Psychologist: "health.psychologist",
  "Registered Nurse": "health.rn",
  "Social Worker": "soc.worker",
  Veterinarian: "health.vet",
  "Education Manager": "edu.admin",
  "Instructional Designer": "edu.instructional",
  Librarian: "edu.library",
  Teacher: "edu.teacher",
  Biologist: "sci.life",
  Chemist: "sci.physical",
  "Environmental Scientist": "sci.physical",
  Geologist: "sci.physical",
  Mathematician: "data.stats",
  Physicist: "sci.physical",
  "Social Scientist": "sci.social",
  "Administrative Assistant": "admin.assistant",
  "Data Entry Clerk": "admin.dataentry",
  "Executive Assistant": "admin.assistant",
  "Office Clerk": "admin.clerk",
  "Office Manager": "admin.supervisor",
  Receptionist: "cs.frontdesk",
  Secretary: "admin.assistant",
} as const satisfies Record<string, string>;

const LEGACY_SUBROLES = {
  Frontend: "sw.frontend",
  Backend: "sw.backend",
  "Full-stack": "sw.fullstack",
  Mobile: "sw.mobile",
  Platform: "infra.devops",
  Embedded: "sw.embedded",
} as const satisfies Record<Subrole, string>;

const roleById = new Map(ROLES.map((role) => [role.id, role]));

const legacySubroleByName = new Map<string, string>(
  Object.entries(LEGACY_SUBROLES).map(([name, id]) => [name.toLowerCase(), id]),
);

const categoryIds = new Set<string>(ROLE_CATEGORIES.map((category) => category.id));
const subcategoryIds = new Set(ROLE_SUBCATEGORIES.map((sub) => sub.id));

const legacyCategoryByName = new Map<string, LegacyCategory>(
  Object.entries(LEGACY_CATEGORIES).map(([name, value]) => [name.toLowerCase(), value]),
);

const legacyRoleByName = new Map<string, string>(
  Object.entries(LEGACY_ROLES).map(([name, id]) => [name.toLowerCase(), id]),
);

/**
 * Converts one Posting's retired tags (28 tech-leaning categories, 134 ESCO Level-2 roles, six software subroles) to
 * the role taxonomy. A vague old role maps to a broad role so it only answers category searches; an old category that
 * spans unrelated work maps to nothing, because a wrong label is worse than none.
 * @param tags The old Level-1 category, Level-2 role and software subrole, each null when absent.
 * @returns The role id and the category id to tag, each null when the old tags do not say it safely.
 */
export function legacyTagToTaxonomy(tags: {
  category: string | null;
  role: string | null;
  subrole?: string | null;
}) {
  const roleId =
    (tags.subrole === undefined || tags.subrole === null
      ? undefined
      : legacySubroleByName.get(tags.subrole.toLowerCase())) ??
    (tags.role === null ? undefined : legacyRoleByName.get(tags.role.toLowerCase()));

  if (roleId !== undefined) {
    const role = roleById.get(roleId);

    return { categoryId: role?.categoryId ?? null, roleId: role === undefined ? null : roleId };
  }

  const category =
    tags.category === null ? undefined : legacyCategoryByName.get(tags.category.toLowerCase());

  return { categoryId: category?.tag ?? null, roleId: null };
}

/**
 * Converts one saved target value to taxonomy ids. A value that is already an id passes through, an old category or
 * role name becomes its ids, and anything else is free text the person typed and is kept as typed.
 * @param value One saved target role.
 * @returns The ids (or the original free text) the target now means.
 */
export function legacyTargetToTaxonomy(value: string) {
  const trimmed = value.trim();

  if (roleById.has(trimmed) || categoryIds.has(trimmed) || subcategoryIds.has(trimmed)) {
    return [trimmed];
  }

  const folded = trimmed.toLowerCase();
  const role = legacyRoleByName.get(folded);

  if (role !== undefined) {
    return [role];
  }

  const subrole = legacySubroleByName.get(folded);

  if (subrole !== undefined) {
    return [subrole];
  }

  const category = legacyCategoryByName.get(folded);

  return category === undefined ? [trimmed] : [...category.target];
}
