import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import { getSetting } from "../settings/index.ts";
import { DAY_MS, dayStartUtc, llmSpendTodayMicros } from "./usage.ts";

export const TAGGING_PURPOSES = ["tag_fallback"] as const;

export type LlmCapKind = "user" | "global" | "tagging";

export function capMicros(db: AppDatabase, key: string) {
  const raw = getSetting(db, key);
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) : 0;
}

export interface LlmCapCheck {
  withinCaps: boolean;
  exceeded: LlmCapKind | null;
  spentMicros: number;
  capMicros: number;
}

export interface LlmCapInput {
  userId: string | null;
  purpose: string;
  estimatedCostMicros: number;
}

function isTagging(purpose: string) {
  for (const taggingPurpose of TAGGING_PURPOSES) {
    if (taggingPurpose === purpose) {
      return true;
    }
  }

  return false;
}

export function checkLlmCaps(db: AppDatabase, clock: Clock, input: LlmCapInput) {
  const now = clock.now();

  const estimate = Math.max(input.estimatedCostMicros, 0);

  const userCap = input.userId === null ? null : capMicros(db, "llm.cap_user_day_usd");
  const taggingCap = isTagging(input.purpose) ? capMicros(db, "llm.cap_tagging_day_usd") : null;
  const globalCap = capMicros(db, "llm.cap_global_day_usd");

  if (userCap !== null) {
    const spent = llmSpendTodayMicros(db, now, null, input.userId);

    if (spent + estimate > userCap) {
      return {
        withinCaps: false,
        exceeded: "user" as const,
        spentMicros: spent,
        capMicros: userCap,
      } satisfies LlmCapCheck;
    }
  }

  if (taggingCap !== null) {
    const spent = llmSpendTodayMicros(db, now, input.purpose, null);

    if (spent + estimate > taggingCap) {
      return {
        withinCaps: false,
        exceeded: "tagging" as const,
        spentMicros: spent,
        capMicros: taggingCap,
      } satisfies LlmCapCheck;
    }
  }

  const globalSpent = llmSpendTodayMicros(db, now, null, null);

  if (globalSpent + estimate > globalCap) {
    return {
      withinCaps: false,
      exceeded: "global" as const,
      spentMicros: globalSpent,
      capMicros: globalCap,
    } satisfies LlmCapCheck;
  }

  return {
    withinCaps: true,
    exceeded: null,
    spentMicros: globalSpent,
    capMicros: globalCap,
  } satisfies LlmCapCheck;
}

export function nextUtcMidnight(atMs: number) {
  return dayStartUtc(atMs) + DAY_MS;
}
