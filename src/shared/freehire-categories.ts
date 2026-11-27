/**
 * freehire's job categories, the role vocabulary a person picks in Preferences (issue #684, SPEC §6.4). A saved role
 * target is one of these ids, or a free-text title word the user typed. A job matches when its freehire `category` is
 * picked, or its title contains one of the picked title words. The list and order come from freehire's `category`
 * facet; a value outside it is never invented.
 */
export const FREEHIRE_CATEGORIES = [
  { id: "software_engineering", name: "Software engineering" },
  { id: "backend", name: "Backend" },
  { id: "frontend", name: "Frontend" },
  { id: "fullstack", name: "Full-stack" },
  { id: "mobile", name: "Mobile" },
  { id: "devops", name: "DevOps" },
  { id: "sre", name: "Site reliability" },
  { id: "network_engineering", name: "Network engineering" },
  { id: "system_administration", name: "System administration" },
  { id: "telecommunications_engineering", name: "Telecommunications engineering" },
  { id: "it_support", name: "IT support" },
  { id: "data_engineering", name: "Data engineering" },
  { id: "data_science", name: "Data science" },
  { id: "data_analytics", name: "Data analytics" },
  { id: "ml_ai", name: "Machine learning & AI" },
  { id: "ai_engineering", name: "AI engineering" },
  { id: "qa", name: "QA & testing" },
  { id: "security", name: "Security" },
  { id: "hardware", name: "Hardware" },
  { id: "embedded", name: "Embedded" },
  { id: "blockchain", name: "Blockchain" },
  { id: "architecture", name: "Architecture" },
  { id: "design", name: "Design" },
  { id: "creative", name: "Creative" },
  { id: "engineering_design", name: "Engineering design" },
  { id: "industrial_engineering", name: "Industrial engineering" },
  { id: "occupational_safety", name: "Occupational safety" },
  { id: "product", name: "Product" },
  { id: "project_management", name: "Project management" },
  { id: "healthcare", name: "Healthcare" },
  { id: "skilled_trades", name: "Skilled trades" },
  { id: "retail", name: "Retail" },
  { id: "hospitality", name: "Hospitality" },
  { id: "logistics", name: "Logistics" },
  { id: "education", name: "Education" },
  { id: "personal_services", name: "Personal services" },
  { id: "administration", name: "Administration" },
  { id: "social_services", name: "Social services" },
  { id: "science", name: "Science" },
  { id: "manufacturing", name: "Manufacturing" },
  { id: "public_safety", name: "Public safety" },
  { id: "marketing", name: "Marketing" },
  { id: "sales", name: "Sales" },
  { id: "support", name: "Customer support" },
  { id: "business_analysis", name: "Business analysis" },
  { id: "solutions_engineering", name: "Solutions engineering" },
  { id: "developer_relations", name: "Developer relations" },
  { id: "technical_writing", name: "Technical writing" },
  { id: "recruiting", name: "Recruiting" },
  { id: "hr", name: "People & HR" },
  { id: "finance", name: "Finance" },
  { id: "legal", name: "Legal" },
  { id: "operations", name: "Operations" },
  { id: "customer_success", name: "Customer success" },
  { id: "other", name: "Other" },
] as const;

export type FreehireCategory = (typeof FREEHIRE_CATEGORIES)[number];

export type FreehireCategoryId = FreehireCategory["id"];

const CATEGORY_BY_ID = new Map<string, FreehireCategory>(
  FREEHIRE_CATEGORIES.map((category) => [category.id, category]),
);

const CATEGORY_BY_NAME = new Map<string, FreehireCategory>(
  FREEHIRE_CATEGORIES.map((category) => [category.name.toLowerCase(), category]),
);

const CATEGORY_IDS = new Set<string>(FREEHIRE_CATEGORIES.map((category) => category.id));

/**
 * @param value Any saved role target.
 * @returns True when the value is a freehire category id rather than a title word.
 */
export function isFreehireCategory(value: string): value is FreehireCategoryId {
  return CATEGORY_IDS.has(value);
}

/**
 * The id a category label names, after trimming and folding case.
 * @param label A category name, such as "Data science".
 * @returns The category id, or null when the label names none.
 */
export function freehireCategoryIdForLabel(label: string) {
  return CATEGORY_BY_NAME.get(label.trim().toLowerCase())?.id ?? null;
}

/**
 * The label a person reads for a category id.
 * @param id A freehire category id.
 * @returns The label, or the id itself for a value freehire no longer uses.
 */
export function freehireCategoryName(id: string) {
  return CATEGORY_BY_ID.get(id)?.name ?? id;
}

/**
 * The category options a picker shows, already labelled.
 * @returns Every freehire category in freehire's own order.
 */
export function freehireCategoryOptions() {
  return FREEHIRE_CATEGORIES.map((category) => ({ label: category.name, value: category.id }));
}
