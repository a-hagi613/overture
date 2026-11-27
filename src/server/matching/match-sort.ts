import type { ScoreBlocker } from "./score-schema.ts";

export const MATCH_HIDDEN_BELOW = 50;

export const MATCH_BANDS = {
  possible: { label: "Possible", max: 69, min: 50 },
  good: { label: "Good", max: 84, min: 70 },
  strong: { label: "Strong", max: 100, min: 85 },
} as const;

export type MatchBand = (typeof MATCH_BANDS)[keyof typeof MATCH_BANDS]["label"];

const BAND_ORDER: Record<MatchBand, number> = { Good: 2, Possible: 1, Strong: 3 };

/** One job as the sort reads it: the stored score plus the facts that break ties, all fixed when it was scored. */
export interface SortableMatch {
  id: string;
  score: number | null;
  blockers: readonly ScoreBlocker[];
  /** True when the job's category or title names a target role exactly, false for a category-only match. */
  exactRole: boolean;
  postedAt: number | null;
  companyKey: string;
}

/**
 * Reads a score's band. A score below the visibility floor has no band because it is never shown.
 * @param score The stored 0–100 score.
 * @returns The band, or null below the floor.
 */
export function matchBandOf(score: number) {
  if (score >= MATCH_BANDS.strong.min) {
    return MATCH_BANDS.strong.label;
  }

  if (score >= MATCH_BANDS.good.min) {
    return MATCH_BANDS.good.label;
  }

  return score >= MATCH_BANDS.possible.min ? MATCH_BANDS.possible.label : null;
}

/**
 * Whether a stored match belongs in the list: it has a score, no blocker, and at least the visibility floor.
 * @param match The stored match.
 * @returns True when the list shows it.
 */
export function matchIsVisible(match: Pick<SortableMatch, "blockers" | "score">) {
  return match.score !== null && match.blockers.length === 0 && match.score >= MATCH_HIDDEN_BELOW;
}

function compareOptionalNumberDescending(left: number | null, right: number | null) {
  return (right ?? 0) - (left ?? 0);
}

/**
 * The whole sort rule from ADR 0045: band, then an exact target role before a category-only match, then score, then
 * the newest posting, then the posting id. The id tie-break makes server pages stable and non-overlapping.
 * @param left One stored match.
 * @param right Another stored match.
 * @returns A negative number when `left` comes first.
 */
export function compareMatches(left: SortableMatch, right: SortableMatch) {
  const leftScore = left.score ?? 0;
  const rightScore = right.score ?? 0;
  const leftBand = matchBandOf(leftScore) ?? "Possible";
  const rightBand = matchBandOf(rightScore) ?? "Possible";

  if (BAND_ORDER[leftBand] !== BAND_ORDER[rightBand]) {
    return BAND_ORDER[rightBand] - BAND_ORDER[leftBand];
  }

  if (left.exactRole !== right.exactRole) {
    return left.exactRole ? -1 : 1;
  }

  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  const posted = compareOptionalNumberDescending(left.postedAt, right.postedAt);

  return posted === 0 ? left.id.localeCompare(right.id) : posted;
}

/**
 * Filters to the visible matches and orders them by the one sort rule. The result is deterministic across calls, so
 * a page load never re-rolls the order.
 * @param matches The stored matches.
 * @returns The visible matches, best first.
 */
export function orderedMatches<T extends SortableMatch>(matches: readonly T[]) {
  return matches.filter((match) => matchIsVisible(match)).toSorted(compareMatches);
}

/**
 * Reads one server page of the ordered list. The posting id tie-break means the next page continues exactly where the
 * previous one ended.
 * @param matches The stored matches.
 * @param offset How many visible matches to skip.
 * @param limit The page size.
 * @returns The page and the visible total.
 */
export function matchPage(matches: readonly SortableMatch[], offset: number, limit: number) {
  const ordered = orderedMatches(matches);

  return { items: ordered.slice(offset, offset + limit), total: ordered.length };
}

/**
 * Onboarding's picks: walk the ordered list and take the first job from each employer until the limit is reached, so
 * one company cannot fill every slot.
 * @param matches The stored matches.
 * @param limit How many picks the plan allows.
 * @returns Up to `limit` matches, one per employer.
 */
export function topPicksByEmployer<T extends SortableMatch>(matches: readonly T[], limit: number) {
  const picked: T[] = [];
  const employers = new Set<string>();

  for (const match of orderedMatches(matches)) {
    if (picked.length >= limit) {
      break;
    }

    if (employers.has(match.companyKey)) {
      continue;
    }

    employers.add(match.companyKey);
    picked.push(match);
  }

  return picked;
}
