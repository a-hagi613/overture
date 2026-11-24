import { ROLE_GROUPS } from "../../shared/tag-taxonomy.ts";
import { ESCO_ROLE_NAMES } from "../../shared/esco-roles.ts";

import type { RoleGroup } from "../../shared/tag-taxonomy.ts";

import { aliasLookupTitle, normalizeClassificationText } from "./classification-key.ts";
import { granularRoleFor } from "./esco-mapping.ts";
import escoOccupationsJson from "./tag-data/esco-occupations.json";

const ROLE_GROUP_NAMES: readonly string[] = ROLE_GROUPS;

interface RawEscoOccupation {
  readonly ec: string;
  readonly u: string;
  readonly isco: string;
  readonly c: string;
  readonly r: string;
  readonly l: Readonly<Record<string, string>>;
  readonly a: Readonly<Record<string, string[]>>;
}

interface EscoDataset {
  readonly version: string;
  readonly source: string;
  readonly occupationCount: number;
  readonly roleCount: number;
  readonly occupations: readonly RawEscoOccupation[];
}

const dataset: EscoDataset = escoOccupationsJson;

export const ESCO_VERSION = dataset.version;

export const ESCO_OCCUPATION_COUNT = dataset.occupationCount;

export interface EscoOccupation {
  readonly code: string;
  readonly uri: string;
  readonly isco: string;
  readonly category: RoleGroup;
  readonly role: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly altLabels: Readonly<Record<string, string[]>>;
}

function isRoleGroup(value: string): value is RoleGroup {
  return ROLE_GROUP_NAMES.includes(value);
}

function toOccupation(raw: RawEscoOccupation) {
  return {
    code: raw.ec,
    uri: raw.u,
    isco: raw.isco,
    category: isRoleGroup(raw.c) ? raw.c : "Operations",
    role: raw.r,
    labels: raw.l,
    altLabels: raw.a,
  };
}

const occupations: readonly EscoOccupation[] = dataset.occupations.map(toOccupation);

const byCode = new Map<string, EscoOccupation>(
  occupations.map((occupation) => [occupation.code, occupation]),
);

export function escoOccupations() {
  return occupations;
}

/**
 * @param code An exact ESCO occupation code such as `2512.1`.
 * @returns The occupation, or null when the code is unknown.
 */
export function escoOccupationByCode(code: string) {
  return byCode.get(code) ?? null;
}

/** Every Level-2 role present in the baked dataset, sorted for a stable UI and tests. Shared with the browser's
 * compact picker vocabulary so the server and the client can never drift. */
export const ESCO_ROLES: readonly string[] = ESCO_ROLE_NAMES;

/** The Level-1 categories the dataset covers, in `ROLE_GROUPS` order. */
export const ESCO_CATEGORIES: readonly RoleGroup[] = ROLE_GROUPS.filter((category) =>
  occupations.some((occupation) => occupation.category === category),
);

/**
 * Every label an occupation answers to, preferred and alternative, in one list. The alias index reads these.
 * @param occupation The occupation.
 * @returns The labels.
 */
export function allLabels(occupation: EscoOccupation) {
  return [
    ...Object.values(occupation.labels),
    ...Object.values(occupation.altLabels).flat(),
  ].filter((label) => label.trim() !== "");
}

let aliasIndex: Map<string, EscoOccupation> | null = null;

/**
 * The exact normalized-label index. It is built on the first lookup so a unit test that only reads the taxonomy does
 * not pay for it.
 * @returns The label-to-occupation map.
 */
export function escoAliasIndex() {
  if (aliasIndex !== null) {
    return aliasIndex;
  }

  const index = new Map<string, EscoOccupation>();

  function addLabel(occupation: EscoOccupation, label: string) {
    for (const variant of [label, ...label.split(/\s*[/|]\s*/u)]) {
      const normalized = normalizeClassificationText(variant);

      if (normalized.length < 2 || index.has(normalized)) {
        continue;
      }

      index.set(normalized, occupation);
    }
  }

  for (const occupation of occupations) {
    for (const label of Object.values(occupation.labels)) {
      addLabel(occupation, label);
    }
  }

  for (const occupation of occupations) {
    for (const label of Object.values(occupation.altLabels).flat()) {
      addLabel(occupation, label);
    }
  }

  aliasIndex = index;

  return index;
}

/**
 * Looks a title up in the ESCO alias index. It first tries the phrase as written, then with the seniority qualifiers
 * removed, which is how `Senior Backend Engineer` still reaches `software developer`.
 * @param phrase The title or phrase to look up.
 * @returns The occupation, or null.
 */
export function lookupEscoOccupations(phrase: string) {
  const index = escoAliasIndex();
  const normalized = normalizeClassificationText(phrase);

  if (normalized === "") {
    return null;
  }

  const exact = index.get(normalized);

  if (exact !== undefined) {
    return exact;
  }

  const stripped = aliasLookupTitle(phrase);

  return stripped === "" ? null : (index.get(stripped) ?? null);
}

export interface EscoClassification {
  readonly category: RoleGroup;
  readonly role: string;
  readonly escoCode: string;
}

/**
 * The Tier-1 ESCO answer for a title, or null when no alias matches.
 * @param title The classification title.
 * @returns The baked category, role and code.
 */
export function classifyWithEsco(title: string) {
  const occupation = lookupEscoOccupations(title);

  return occupation === null
    ? null
    : { category: occupation.category, role: occupation.role, escoCode: occupation.code };
}

/**
 * A department or `job_category` value promoted to a Level-1 category. It matches an exact role group, a granular
 * role, or a title-style phrase; it never changes the stored department.
 * @param value The department or category text, or null.
 * @returns The category, or null.
 */
export function categoryHintFromText(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = normalizeClassificationText(value);

  if (normalized === "") {
    return null;
  }

  const exact = ROLE_GROUPS.find((group) => normalizeClassificationText(group) === normalized);

  if (exact !== undefined) {
    return exact;
  }

  const granular = granularRoleFor(value);

  return granular?.category ?? null;
}

/**
 * The Level-2 role prototypes Tier 2 embeds first, one per distinct `(category, role)` pair. Comparing a query
 * against ~130 role prototypes instead of ~2,900 occupation prototypes is what keeps a large snapshot inside the
 * runner's CPU budget; the occupation prototypes are then only searched inside the accepted role.
 * @returns The role prototypes, sorted by category then role.
 */
export function escoRolePrototypes() {
  const byRole = new Map<string, { category: RoleGroup; role: string; text: string }>();

  for (const occupation of occupations) {
    const key = `${occupation.category}|${occupation.role}`;

    if (!byRole.has(key)) {
      byRole.set(key, {
        category: occupation.category,
        role: occupation.role,
        text: `${occupation.role} (${occupation.category})`,
      });
    }
  }

  return [...byRole.values()].toSorted(
    (left, right) =>
      left.category.localeCompare(right.category, "en") ||
      left.role.localeCompare(right.role, "en"),
  );
}

/**
 * The occupations that belong to one Level-2 role, used to resolve the Level-3 ESCO code after the role is accepted.
 * @param role A Level-2 role name.
 * @returns The occupations with that role.
 */
export function escoOccupationsForRole(role: string) {
  return occupations.filter((occupation) => occupation.role === role);
}

export interface EscoPrototype {
  readonly code: string;
  readonly category: RoleGroup;
  readonly role: string;
  readonly text: string;
}

let prototypes: readonly EscoPrototype[] | null = null;

/**
 * The texts Tier 2 embeds once. One prototype per distinct English preferred label, so the embeddings carry the whole
 * occupation vocabulary without spending a request on duplicates.
 * @returns The prototype list, sorted by code.
 */
export function escoPrototypes() {
  if (prototypes !== null) {
    return prototypes;
  }

  const seen = new Set<string>();
  const list: EscoPrototype[] = [];

  for (const occupation of occupations) {
    const text = occupation.labels.en ?? Object.values(occupation.labels)[0] ?? occupation.role;
    const normalized = normalizeClassificationText(text);

    if (normalized === "" || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    list.push({
      code: occupation.code,
      category: occupation.category,
      role: occupation.role,
      text,
    });
  }

  prototypes = list;

  return list;
}
