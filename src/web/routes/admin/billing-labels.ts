import { copy } from "../../../shared/copy.ts";
import type { BillingFilter, BillingPeriod } from "../../lib/admin-api.ts";

export type BillingStateKey = "trial" | "paying" | "ending" | "paused" | "ended" | "none";

export const billingLinkClass =
  "inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold underline underline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

export const BILLING_FILTER_ORDER: readonly BillingFilter[] = [
  "all",
  "trial",
  "paying",
  "paused",
  "ended",
];

export function billingStateLabel(state: BillingStateKey) {
  const labels: Record<BillingStateKey, string> = {
    ending: copy.admin.billingStateEnding,
    ended: copy.admin.billingStateEnded,
    none: copy.admin.billingStateNone,
    paused: copy.admin.billingStatePaused,
    paying: copy.admin.billingStatePaying,
    trial: copy.admin.billingStateTrial,
  };

  return labels[state];
}

export function billingPlanLabel(plan: BillingPeriod["plan"] | "trial" | null) {
  if (plan === "week") {
    return copy.admin.billingPlanWeek;
  }

  if (plan === "month") {
    return copy.admin.billingPlanMonth;
  }

  if (plan === "trial") {
    return copy.admin.billingPlanTrial;
  }

  return copy.admin.billingNoPlan;
}

export function dayOf(at: number) {
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function periodSpan(period: BillingPeriod) {
  const end = period.expiresAt === null ? copy.admin.billingNoPeriod : dayOf(period.expiresAt);

  return `${dayOf(period.startsAt)} to ${end}`;
}
