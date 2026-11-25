import type { HomeRangeKey, HomeResponse } from "./home-api.ts";

import { copy } from "../../shared/copy.ts";

const RANGE_DAYS: Record<HomeRangeKey, number> = { "7D": 7, "30D": 30, "90D": 90 };

export const HOME_RANGE_KEYS = ["7D", "30D", "90D"] as const satisfies readonly HomeRangeKey[];

export const HOME_RANGE_LABELS: Record<HomeRangeKey, string> = {
  "7D": copy.home.ranges.d7,
  "30D": copy.home.ranges.d30,
  "90D": copy.home.ranges.d90,
};

/**
 * Days covered by an outcome range, for the "vs the previous N days" line.
 * @param rangeKey The selected 7D, 30D or 90D range.
 * @returns The range length in days.
 */
export function rangeDays(rangeKey: HomeRangeKey) {
  return RANGE_DAYS[rangeKey];
}

export function isHomeRangeKey(value: string): value is HomeRangeKey {
  return value === "7D" || value === "30D" || value === "90D";
}

export interface HomeActionState {
  failed: readonly unknown[];
  readyCount: number;
  reviewTotal: number;
}

/**
 * The Home data that decides whether anything waits for the person.
 * @param home The Home response.
 * @returns Counts and rows for the action queue.
 */
export function homeActionStateOf(home: HomeResponse) {
  const state: HomeActionState = {
    failed: home.activity.failed,
    readyCount: home.ready.ready,
    reviewTotal: home.reviews.total,
  };

  return state;
}

/**
 * True when Home has nothing waiting for the person: no verification code to
 * paste, no open Review, no Ready approval and no recent failure.
 * @param state The action counts.
 * @param codeWaitAsking Whether a code-wait card is asking for a paste.
 * @returns Whether the All caught up state applies.
 */
export function isAllCaughtUp(state: HomeActionState, codeWaitAsking: boolean) {
  return (
    !codeWaitAsking &&
    state.reviewTotal === 0 &&
    state.readyCount === 0 &&
    state.failed.length === 0
  );
}
