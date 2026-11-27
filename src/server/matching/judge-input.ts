import { gunzipSync } from "node:zlib";

import type { TargetsInput } from "../../shared/targets.ts";

import { describePlaceIds } from "../places/catalog.ts";
import { freehireCategoryName, isFreehireCategory } from "../../shared/freehire-categories.ts";
import { roleTaxonomyName } from "../../shared/role-taxonomy.ts";

const SUMMARY_WORDS = 200;
const SUMMARY_CHARS = 2000;

const ROLE_TAG_DIMENSIONS = ["granular_role", "subrole", "role"] as const;

/**
 * The most specific role a Posting's tags name, as a readable name: its role, else its subcategory, else its category.
 * @param tags The Posting's tags.
 * @returns The name, or null when the Posting has no role tag.
 */
export function postingRoleName(tags: readonly { dimension: string; value: string }[]) {
  for (const dimension of ROLE_TAG_DIMENSIONS) {
    const tag = tags.find((entry) => entry.dimension === dimension);

    if (tag !== undefined) {
      return roleTaxonomyName(tag.value);
    }
  }

  return null;
}

/**
 * The `tags:` line the scorer reads: the Posting's most specific role by name and its seniority.
 * @param tags The Posting's tags.
 * @returns One line such as `role:Registered Nurse seniority:senior`.
 */
export function scoreTagsLine(tags: readonly { dimension: string; value: string }[]) {
  const role = postingRoleName(tags);
  const seniority = tags.find((tag) => tag.dimension === "seniority")?.value;

  return [
    role === null ? null : `role:${role}`,
    seniority === undefined ? null : `seniority:${seniority}`,
  ]
    .filter((part) => part !== null)
    .join(" ");
}

/**
 * The `summary:` the scorer reads: the first 200 words of the stored description, capped at 2,000 characters, so the
 * scorer sees the requirements (licences, languages, stack) a title leaves out.
 * @param descriptionGz The gzip-compressed plain-text description, or null.
 * @returns The summary, or an empty string when there is none or it cannot be read.
 */
export function descriptionSummary(descriptionGz: Uint8Array | null) {
  if (descriptionGz === null) {
    return "";
  }

  try {
    return gunzipSync(descriptionGz)
      .toString("utf8")
      .split(/\s+/u)
      .filter((word) => word.length > 0)
      .slice(0, SUMMARY_WORDS)
      .join(" ")
      .slice(0, SUMMARY_CHARS);
  } catch {
    return "";
  }
}

/**
 * The `targets:` line the scorer reads, so it judges the Posting against what the person asked for and not only the
 * resume: the role categories they picked and the title words they typed, plus their places. Role and place are the
 * only hard filters (issue #684); level, workplace and pay are not preferences any more.
 * @param targets The person's saved preferences.
 * @returns One line such as `roles: Healthcare, ICU charge nurse; places: Houston, TX`.
 */
export function targetsLine(targets: TargetsInput) {
  const roles = [
    ...new Set(
      targets.roles.map((role) => (isFreehireCategory(role) ? freehireCategoryName(role) : role)),
    ),
  ];

  return [
    roles.length === 0 ? null : `roles: ${roles.join(", ")}`,
    targets.locations.length === 0
      ? null
      : `places: ${describePlaceIds(targets.locations)
          .map((place) => (place.meta === "" ? place.label : `${place.label}, ${place.meta}`))
          .join(" or ")}`,
  ]
    .filter((part) => part !== null)
    .join("; ");
}
