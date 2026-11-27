import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { planSummaryText } from "../../shared/plans.ts";
import { useBilling } from "../lib/billing-api.ts";
import { Card } from "./ui/card.tsx";

/**
 * The Tracker's one-line plan strip: the plan the person chose and what it includes, so every later screen
 * repeats the same choice. It renders nothing before a plan exists.
 * @returns The plan strip, or null when there is no plan.
 */
export function TrackerPlanBanner() {
  const { data } = useBilling();

  if (data === undefined || data.planKind === "none") {
    return null;
  }

  return (
    <Card
      className="mt-3 flex flex-wrap items-center justify-between gap-2 px-4 py-3"
      dataTestId="tracker-plan-banner"
      variant="muted"
    >
      <p className="text-sm font-medium text-foreground tabular-nums">
        {planSummaryText(data.planKind)}
      </p>
      <Link
        className="text-xs font-semibold text-signal-text underline-offset-4 hover:underline"
        to="/profile/billing"
      >
        {copy.home.balance.manage}
      </Link>
    </Card>
  );
}
