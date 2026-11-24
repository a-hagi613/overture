import { isRemoteLocationText, normalizePlaceName, resolveLocation } from "./geo.ts";

/**
 * The EU gender markers a posting title carries, such as `(m/w/d)`, `(f/m/x)`, `(w/m/d)` and `m/f/d`.
 * The separator has to appear between at least two tokens, so an ordinary word or a range such as `R&D` is never
 * mistaken for one.
 */
const GENDER_MARKER =
  /[([{]?\s*\b(?:m|w|f|d|x|h|gn|divers)(?:\s*[/|]\s*(?:m|w|f|d|x|h|gn|divers))+\b\s*[)\]}]?/giu;

/** A bare `(gn)` or `(all genders)` marker carries no separators, so it is removed on its own. */
const BARE_GENDER_MARKER = /[([{]?\s*(?:gn|all genders|any gender|m\/f\/d\/x|divers)\s*[)\]}]?/giu;

/**
 * The separators a title uses between the role and a trailing location. The last one in the title is the boundary
 * that is tested, so a role that itself contains a comma or a slash is only shortened when the final segment is a
 * place.
 */
const TRAILING_SEPARATOR = /[-–—•·|/,;:()[\]]|\s+(?:in|at)\s+/giu;

const SENIORITY_QUALIFIERS =
  /\b(?:intern(?:ship)?|co-?op|senior|junior|staff|principal|director|head of|vp|vice president|lead|manager|mgr|distinguished|associate|graduate|entry[- ]level|new grad|trainee|working student|chief|president|cxo|ceo|cto|cfo|coo)\b/giu;

const ROMAN_LEVEL = /\b(?:i{1,4}|iv|v)\b/gu;

const EU_COUNTRY_CODE = /^[a-z]{2}$/u;

/**
 * Removes the EU gender markers from a title without touching anything else.
 * @param title The raw title.
 * @returns The title with `(m/w/d)`-style markers gone.
 */
export function stripGenderMarkers(title: string) {
  return title
    .replaceAll(GENDER_MARKER, " ")
    .replaceAll(BARE_GENDER_MARKER, " ")
    .replaceAll(/\s{2,}/gu, " ")
    .trim();
}

function isLocationSegment(segment: string) {
  const trimmed = segment
    .replace(/^\s*(?:in|at|based in|location:?)\s+/iu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();

  if (trimmed === "") {
    return false;
  }

  if (isRemoteLocationText(trimmed)) {
    return true;
  }

  const resolved = resolveLocation(trimmed);

  if (resolved.countryCode !== null || resolved.city !== null) {
    return true;
  }

  // A bare two-letter country/state code, or `City, ST`, is a location even when the city is not in the dataset.
  return (
    EU_COUNTRY_CODE.test(normalizePlaceName(trimmed)) ||
    /^[A-Za-z .'-]+,\s*[A-Z]{2}$/u.test(trimmed)
  );
}

/**
 * Strips trailing location phrases such as `- Berlin`, `| Remote` or `(London, UK)` while preserving every seniority,
 * level and track qualifier. It walks separators from the end, so a title whose role itself contains a comma is only
 * shortened when the final segment really is a place.
 * @param title The title, with gender markers already removed or not.
 * @returns The title without its trailing location.
 */
export function stripTrailingLocation(title: string) {
  let current = title.trim();

  for (;;) {
    let cut = -1;
    let separatorLength = 0;

    for (const match of current.matchAll(TRAILING_SEPARATOR)) {
      cut = match.index;
      separatorLength = match[0].length;
    }

    if (cut < 0) {
      return current.trim();
    }

    const trailing = current.slice(cut + separatorLength).trim();
    const leading = current.slice(0, cut).trim();

    if (trailing === "") {
      current = leading;
      continue;
    }

    if (!isLocationSegment(trailing)) {
      return current.trim();
    }

    current = leading;
  }
}

/**
 * The non-destructive classification title: gender markers and a trailing location removed, seniority and track kept.
 * `postings.title` itself is never changed.
 * @param title The raw posting title.
 * @returns The cleaned title.
 */
export function classificationTitle(title: string) {
  return stripTrailingLocation(stripGenderMarkers(title));
}

/**
 * The normalization shared by the classification key and the ESCO alias index. It folds accents but keeps every
 * Unicode letter and digit, so a Japanese or Greek title is not reduced to the empty string the way an ASCII-only
 * normalizer would reduce it.
 * @param value The text to normalize.
 * @returns Lowercase words separated by single spaces.
 */
export function normalizeClassificationText(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The normalized department half of the classification key.
 * @param department The raw department, or null.
 * @returns The normalized department, or an empty string.
 */
export function classificationDepartment(department: string | null | undefined) {
  return normalizeClassificationText(department ?? "");
}

/**
 * The cache and classification key for a posting: `(class_title_norm, dept_norm)`. Two postings with the same key
 * receive the same classification, which is what makes the cache worth shipping.
 * @param title The raw posting title.
 * @param department The raw department, or null.
 * @returns The two normalized halves and the joined key.
 */
export function classificationKey(title: string, department: string | null | undefined) {
  const titleNorm = normalizeClassificationText(classificationTitle(title));
  const deptNorm = classificationDepartment(department);

  return { titleNorm, deptNorm, key: `${titleNorm}|${deptNorm}` };
}

/**
 * The title to look up in the ESCO alias index. Seniority qualifiers and roman levels are dropped because an ESCO
 * occupation label is never seniority-qualified, while the stored classification key keeps them.
 * @param title The classification title.
 * @returns The alias-lookup phrase.
 */
export function aliasLookupTitle(title: string) {
  return normalizeClassificationText(
    title.replaceAll(SENIORITY_QUALIFIERS, " ").replaceAll(ROMAN_LEVEL, " "),
  );
}
