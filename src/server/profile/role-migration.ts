import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";

import type { FreehireCategoryId } from "../../shared/freehire-categories.ts";

import { targets } from "../platform/db/schema.ts";
import {
  freehireCategoryIdForLabel,
  isFreehireCategory,
} from "../../shared/freehire-categories.ts";
import { isRoleTaxonomyValue, ROLES, ROLE_SUBCATEGORIES } from "../../shared/role-taxonomy.ts";

const stringArraySchema = z.array(z.string());

const SUBCATEGORY_TO_FREEHIRE = {
  "software-it/software-engineering": "software_engineering",
  "software-it/business-systems": "business_analysis",
  "software-it/infrastructure": "devops",
  "software-it/it-support": "it_support",
  "software-it/security": "security",
  "software-it/it-management": "project_management",
  "software-it/other-it": "software_engineering",
  "data-ai/data": "data_engineering",
  "data-ai/ai": "ml_ai",
  "product-design/product": "product",
  "product-design/design": "design",
  "engineering/mechanical": "engineering_design",
  "engineering/electrical": "engineering_design",
  "engineering/civil": "engineering_design",
  "engineering/process": "engineering_design",
  "engineering/manufacturing": "industrial_engineering",
  "engineering/aerospace": "engineering_design",
  "engineering/energy": "engineering_design",
  "engineering/safety": "occupational_safety",
  "engineering/other": "engineering_design",
  "engineering/architecture": "architecture",
  "engineering/technicians": "engineering_design",
  "science/life-sciences": "science",
  "science/physical-sciences": "science",
  "science/social-sciences": "science",
  "science/lab": "science",
  "science/safety": "occupational_safety",
  "healthcare/nursing": "healthcare",
  "healthcare/physicians": "healthcare",
  "healthcare/dental": "healthcare",
  "healthcare/pharmacy": "healthcare",
  "healthcare/therapy": "healthcare",
  "healthcare/behavioral-health": "healthcare",
  "healthcare/diagnostics": "healthcare",
  "healthcare/emergency": "healthcare",
  "healthcare/surgery": "healthcare",
  "healthcare/veterinary": "healthcare",
  "healthcare/health-admin": "healthcare",
  "healthcare/other-practitioners": "healthcare",
  "healthcare/other-technicians": "healthcare",
  "healthcare/eye-care": "healthcare",
  "healthcare/hearing": "healthcare",
  "healthcare/nutrition": "healthcare",
  "healthcare/life-sciences-industry": "healthcare",
  "care-health-support/care": "healthcare",
  "care-health-support/clinic-support": "healthcare",
  "care-health-support/childcare": "education",
  "education/early-years": "education",
  "education/schools": "education",
  "education/higher-education": "education",
  "education/other-teaching": "education",
  "education/administration": "education",
  "education/libraries-museums": "education",
  "education/corporate-training": "education",
  "sales/b2b-sales": "sales",
  "sales/sales-leadership": "sales",
  "sales/retail": "retail",
  "sales/consumer-sales": "sales",
  "sales/other-sales": "sales",
  "marketing-communications/marketing": "marketing",
  "marketing-communications/communications": "marketing",
  "marketing-communications/content": "marketing",
  "marketing-communications/fundraising": "marketing",
  "customer-service/customer-support": "support",
  "customer-service/customer-success": "customer_success",
  "customer-service/front-desk": "administration",
  "finance-accounting/accounting": "finance",
  "finance-accounting/finance": "finance",
  "finance-accounting/banking": "finance",
  "people-hr/recruiting": "recruiting",
  "people-hr/hr": "hr",
  "business-operations/projects": "project_management",
  "business-operations/consulting": "business_analysis",
  "business-operations/operations": "operations",
  "business-operations/purchasing": "logistics",
  "business-operations/supply-chain": "logistics",
  "business-operations/compliance": "operations",
  "business-operations/insurance": "finance",
  "business-operations/construction": "operations",
  "business-operations/events": "operations",
  "business-operations/ai-data-trust": "operations",
  "business-operations/revenue-operations": "operations",
  "management/executive": "operations",
  "management/general": "operations",
  "management/technology": "operations",
  "management/engineering": "operations",
  "management/production": "manufacturing",
  "management/logistics": "logistics",
  "management/healthcare": "healthcare",
  "management/hospitality": "hospitality",
  "management/construction": "operations",
  "management/real-estate": "operations",
  "management/community": "social_services",
  "management/facilities": "administration",
  "management/other": "operations",
  "legal/lawyers": "legal",
  "legal/legal-support": "legal",
  "admin-office/administration": "administration",
  "admin-office/clerical": "administration",
  "admin-office/supervision": "administration",
  "hospitality-food/kitchen": "hospitality",
  "hospitality-food/front-of-house": "hospitality",
  "hospitality-food/supervision": "hospitality",
  "hospitality-food/production": "hospitality",
  "hospitality-food/hotels": "hospitality",
  "cleaning-grounds/cleaning": "personal_services",
  "cleaning-grounds/grounds": "personal_services",
  "skilled-trades/electrical": "skilled_trades",
  "skilled-trades/plumbing": "skilled_trades",
  "skilled-trades/carpentry": "skilled_trades",
  "skilled-trades/hvac": "skilled_trades",
  "skilled-trades/metal": "skilled_trades",
  "skilled-trades/finishing": "skilled_trades",
  "skilled-trades/roofing": "skilled_trades",
  "skilled-trades/masonry": "skilled_trades",
  "skilled-trades/labour": "skilled_trades",
  "skilled-trades/equipment": "skilled_trades",
  "skilled-trades/energy": "skilled_trades",
  "skilled-trades/supervision": "skilled_trades",
  "skilled-trades/inspection": "skilled_trades",
  "skilled-trades/extraction": "skilled_trades",
  "skilled-trades/other": "skilled_trades",
  "maintenance-repair/vehicles": "skilled_trades",
  "maintenance-repair/aviation": "skilled_trades",
  "maintenance-repair/buildings": "skilled_trades",
  "maintenance-repair/industrial": "skilled_trades",
  "maintenance-repair/electronics": "skilled_trades",
  "maintenance-repair/telecom": "skilled_trades",
  "maintenance-repair/energy": "skilled_trades",
  "maintenance-repair/supervision": "skilled_trades",
  "maintenance-repair/other": "skilled_trades",
  "manufacturing/assembly": "manufacturing",
  "manufacturing/machining": "manufacturing",
  "manufacturing/operations": "manufacturing",
  "manufacturing/quality": "manufacturing",
  "manufacturing/supervision": "manufacturing",
  "manufacturing/food-production": "manufacturing",
  "manufacturing/printing": "manufacturing",
  "manufacturing/textiles": "manufacturing",
  "manufacturing/woodwork": "manufacturing",
  "manufacturing/plant-operations": "manufacturing",
  "manufacturing/labs": "manufacturing",
  "transport-logistics/driving": "logistics",
  "transport-logistics/warehouse": "logistics",
  "transport-logistics/coordination": "logistics",
  "transport-logistics/aviation": "logistics",
  "transport-logistics/supervision": "logistics",
  "transport-logistics/rail": "logistics",
  "transport-logistics/marine": "logistics",
  "transport-logistics/postal": "logistics",
  "transport-logistics/other": "logistics",
  "protective-services/security": "public_safety",
  "protective-services/law-enforcement": "public_safety",
  "protective-services/fire": "public_safety",
  "protective-services/supervision": "public_safety",
  "protective-services/retail-security": "public_safety",
  "community-social-services/social-work": "social_services",
  "community-social-services/counselling": "social_services",
  "community-social-services/support-work": "social_services",
  "community-social-services/justice": "social_services",
  "community-social-services/religion": "social_services",
  "arts-media/production": "creative",
  "arts-media/performance": "creative",
  "arts-media/journalism": "creative",
  "arts-media/language": "creative",
  "arts-media/writing": "technical_writing",
  "arts-media/technical": "creative",
  "arts-media/visual": "creative",
  "arts-media/other": "creative",
  "personal-services/beauty": "personal_services",
  "personal-services/wellness": "personal_services",
  "personal-services/fitness": "personal_services",
  "personal-services/recreation": "personal_services",
  "personal-services/animals": "personal_services",
  "personal-services/funeral": "personal_services",
  "personal-services/travel": "personal_services",
  "personal-services/residential": "personal_services",
  "personal-services/other": "personal_services",
  "agriculture-outdoors/farming": "other",
  "military/military": "public_safety",
} as const satisfies Record<string, FreehireCategoryId>;

const ROLE_OVERRIDES = {
  "data.analyst": "data_analytics",
  "data.engineer": "data_engineering",
  "data.scientist": "data_science",
  "data.stats": "data_science",
  "data.clinical": "healthcare",
  "design.graphic": "creative",
  "design.other": "creative",
  "infra.devops": "devops",
  "infra.dba": "system_administration",
  "infra.network": "network_engineering",
  "infra.sysadmin": "system_administration",
  "infra.architect": "architecture",
  "ml.engineer": "ml_ai",
  "ml.research": "ml_ai",
  "sw.backend": "backend",
  "sw.embedded": "embedded",
  "sw.frontend": "frontend",
  "sw.fullstack": "fullstack",
  "sw.general": "software_engineering",
  "sw.mobile": "mobile",
  "sw.qa": "qa",
  "sw.web": "frontend",
} as const satisfies Record<string, FreehireCategoryId>;

const CATEGORY_TO_FREEHIRE = {
  "admin-office": "administration",
  "agriculture-outdoors": "other",
  "arts-media": "creative",
  "business-operations": "operations",
  "care-health-support": "healthcare",
  "cleaning-grounds": "personal_services",
  "community-social-services": "social_services",
  "customer-service": "support",
  education: "education",
  engineering: "engineering_design",
  "finance-accounting": "finance",
  healthcare: "healthcare",
  "hospitality-food": "hospitality",
  legal: "legal",
  management: "operations",
  manufacturing: "manufacturing",
  "marketing-communications": "marketing",
  military: "public_safety",
  "people-hr": "hr",
  "personal-services": "personal_services",
  "protective-services": "public_safety",
  sales: "sales",
  science: "science",
  "skilled-trades": "skilled_trades",
  "software-it": "software_engineering",
  "transport-logistics": "logistics",
} as const satisfies Record<string, FreehireCategoryId>;

const SUBCATEGORY_CATEGORIES = new Map<string, FreehireCategoryId>(
  Object.entries(SUBCATEGORY_TO_FREEHIRE),
);

const ROLE_CATEGORY_OVERRIDES = new Map<string, FreehireCategoryId>(Object.entries(ROLE_OVERRIDES));

const CATEGORY_CATEGORIES = new Map<string, FreehireCategoryId>(
  Object.entries(CATEGORY_TO_FREEHIRE),
);

const ROLE_BY_NAME = new Map(ROLES.map((role) => [role.name.toLowerCase(), role]));

const ROLE_BY_ID = new Map(ROLES.map((role) => [role.id, role]));

const SUBCATEGORY_BY_NAME = new Map(
  ROLE_SUBCATEGORIES.map((subcategory) => [subcategory.name.toLowerCase(), subcategory.id]),
);

function overrideForRole(roleId: string, subcategoryId: string) {
  return ROLE_CATEGORY_OVERRIDES.get(roleId) ?? SUBCATEGORY_CATEGORIES.get(subcategoryId) ?? null;
}

/**
 * The one freehire category a retired role target means, or null when it names none or several.
 *
 * Order: an id freehire already uses, a freehire category label, a saved role name or id through its old subcategory,
 * then a saved old category name or id. Anything else that was a taxonomy value is ambiguous and stays unresolved;
 * anything else was free text, which is a title word the person meant as typed.
 * @param value A saved role target from before #684.
 * @returns The freehire category id, or null for an ambiguous legacy value.
 */
export function freehireCategoryForLegacyRole(value: string) {
  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  if (isFreehireCategory(trimmed)) {
    return trimmed;
  }

  const byLabel = freehireCategoryIdForLabel(trimmed);

  if (byLabel !== null) {
    return byLabel;
  }

  const role = ROLE_BY_ID.get(trimmed) ?? ROLE_BY_NAME.get(trimmed.toLowerCase());

  if (role !== undefined) {
    return overrideForRole(role.id, role.subcategoryId);
  }

  const subcategoryId = SUBCATEGORY_BY_NAME.get(trimmed.toLowerCase()) ?? trimmed;
  const subcategory = SUBCATEGORY_CATEGORIES.get(subcategoryId);

  if (subcategory !== undefined) {
    return subcategory;
  }

  return CATEGORY_CATEGORIES.get(trimmed) ?? ROLE_CATEGORY_OVERRIDES.get(trimmed) ?? null;
}

/**
 * Reads a saved role list as freehire categories plus the person's own title words. A known retired value that names
 * no single freehire category is preserved in `unresolved`, so the person sees it and picks; a free-text value stays
 * a title word, which is exactly what it was.
 * @param roles The roles stored before #684.
 * @returns The resolved freehire ids and title words, and the ambiguous retired values.
 */
export function migrateLegacyRoles(roles: readonly string[]) {
  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const role of roles) {
    const trimmed = role.trim();

    if (trimmed === "") {
      continue;
    }

    const category = freehireCategoryForLegacyRole(trimmed);

    if (category !== null) {
      if (!resolved.includes(category)) {
        resolved.push(category);
      }

      continue;
    }

    if (isRoleTaxonomyValue(trimmed)) {
      if (!unresolved.includes(trimmed)) {
        unresolved.push(trimmed);
      }

      continue;
    }

    if (!resolved.includes(trimmed)) {
      resolved.push(trimmed);
    }
  }

  return { resolved, unresolved };
}

function stringsOf(value: string) {
  return stringArraySchema.parse(JSON.parse(value));
}

/**
 * Converts every saved role target to a freehire category or title word, once, at boot. The Drizzle migration cannot
 * read the retired taxonomy in SQL, so it leaves `roles` as they were and adds `unresolved_roles`; this pass maps a
 * value that names exactly one freehire category and keeps the rest for the person to resolve. Idempotent: a row that
 * already holds only freehire ids and title words is not written.
 * @param db The application database, after its migrations.
 * @returns How many rows changed.
 */
export function promoteStoredTargetRoles(db: AppDatabase) {
  let changed = 0;

  for (const row of db.select().from(targets).all()) {
    const current = stringsOf(row.roles);
    const migrated = migrateLegacyRoles(current);
    const unresolved = [...new Set([...stringsOf(row.unresolvedRoles), ...migrated.unresolved])];
    const nextRoles = JSON.stringify(migrated.resolved);
    const nextUnresolved = JSON.stringify(unresolved);

    if (nextRoles === row.roles && nextUnresolved === row.unresolvedRoles) {
      continue;
    }

    db.update(targets)
      .set({ roles: nextRoles, unresolvedRoles: nextUnresolved })
      .where(eq(targets.userId, row.userId))
      .run();

    changed += 1;
  }

  return changed;
}
