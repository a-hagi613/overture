import { z } from "zod";

const locationEntrySchema = z.object({
  label: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country_iso: z.string().optional(),
  is_primary: z.boolean().optional(),
});

const skillObjectSchema = z.object({
  name: z.string().optional(),
  label: z.string().optional(),
  skill: z.string().optional(),
  title: z.string().optional(),
  requirement: z.string().optional(),
});

/**
 * Requisition strings that carry no identity. A mirror board writes one of these when it has no requisition, so they
 * must not join Pass-1's `(company, requisition)` partition.
 */
export const GENERIC_REQUISITION_IDS = new Set([
  "",
  "0",
  "-",
  "n/a",
  "na",
  "none",
  "null",
  "tbd",
  "unknown",
  "not specified",
]);

/**
 * @param requisitionId The feed's requisition id.
 * @returns True when the value can identify a job inside a company.
 */
export function hasUsableRequisitionId(requisitionId: string | null | undefined) {
  if (requisitionId === null || requisitionId === undefined) {
    return false;
  }

  return !GENERIC_REQUISITION_IDS.has(requisitionId.trim().toLowerCase());
}

/**
 * The strict title normalization Pass-2 dedupe uses. It folds case, accents and punctuation and removes EU gender
 * markers, but keeps every letter and digit, so `Engineer II` never collapses into `Engineer III` and a seniority or
 * track qualifier always survives.
 * @param title The raw title.
 * @returns The normalized title.
 */
export function normalizeExactTitle(title: string) {
  return title
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .normalize("NFC")
    .replaceAll(
      /[([{]?\s*\b(?:m|w|f|d|x|h|gn|divers)(?:\s*[/|]\s*(?:m|w|f|d|x|h|gn|divers))+\b\s*[)\]}]?/giu,
      " ",
    )
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface StapplyLocation {
  readonly label: string;
  readonly city: string | null;
  readonly region: string | null;
  readonly countryCode: string | null;
  readonly isPrimary: boolean;
}

/**
 * Parses the feed's `locations` JSON. The column is a JSON array of `{label, city?, region?, country_iso?,
 * is_primary?}` objects; a non-JSON value is treated as one label.
 * @param raw The `locations` column.
 * @returns The parsed locations, primary first.
 */
export function parseStapplyLocations(raw: string | null | undefined) {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [{ label: raw.trim(), city: null, region: null, countryCode: null, isPrimary: false }];
    }

    return parsed
      .flatMap((entry) => {
        const result = locationEntrySchema.safeParse(entry);

        if (!result.success) {
          return [];
        }

        const label = result.data.label?.trim() ?? "";

        if (label === "") {
          return [];
        }

        return [
          {
            label,
            city: result.data.city?.trim() ?? null,
            region: result.data.region?.trim() ?? null,
            countryCode: result.data.country_iso?.trim().toUpperCase() ?? null,
            isPrimary: result.data.is_primary === true,
          },
        ];
      })
      .toSorted((left, right) => Number(right.isPrimary) - Number(left.isPrimary));
  } catch {
    return [{ label: raw.trim(), city: null, region: null, countryCode: null, isPrimary: false }];
  }
}

/**
 * The label Pass-2 uses to tell one opening from another. It prefers the primary feed location, then the plain
 * `location`, and includes the country so a bare `Remote` never joins two countries' openings.
 * @param input The country, plain location and `locations` column.
 * @returns The normalized location key, or an empty string when the feed has no location.
 */
export function stapplyLocationKey(input: {
  readonly countryCode: string | null;
  readonly location: string | null;
  readonly locations: string | null;
}) {
  const [primary] = parseStapplyLocations(input.locations);
  const label = primary?.label ?? input.location ?? "";
  const country = (primary?.countryCode ?? input.countryCode ?? "").toUpperCase();

  return `${country}|${normalizeExactTitle(label)}`;
}

/**
 * Extracts the skill names from the feed's `skill_requirements` JSON. The column is normally an array of strings or
 * small objects; a plain comma-separated value is accepted too. Duplicates and empty values are dropped.
 * @param raw The `skill_requirements` column.
 * @returns The skill names, capped at 40.
 */
export function parseSkillRequirements(raw: string | null | undefined) {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return [];
  }

  const values: string[] = [];

  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const text = z.string().safeParse(entry);

        if (text.success) {
          values.push(text.data);
          continue;
        }

        const object = skillObjectSchema.safeParse(entry);

        if (!object.success) {
          continue;
        }

        const value =
          object.data.name ??
          object.data.label ??
          object.data.skill ??
          object.data.title ??
          object.data.requirement;

        if (value !== undefined) {
          values.push(value);
        }
      }
    }
  } catch {
    values.push(...raw.split(/[,;\n]/u));
  }

  return [
    ...new Set(
      values.flatMap((value) => {
        const trimmed = value.trim();

        return trimmed === "" ? [] : [trimmed];
      }),
    ),
  ].slice(0, 40);
}
