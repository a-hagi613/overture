import { Link } from "react-router";

import type { HomeResponse } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { dayText } from "../lib/billing-format.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";

const COPY = copy.home;

export function HomeBillingNotice(props: {
  applicationsLeft: number;
  endingGrant: HomeResponse["endingGrant"];
  planApplications: number;
}) {
  const { applicationsLeft, endingGrant, planApplications } = props;

  if (endingGrant !== null) {
    const { applicationsLeft: left, expiresAt } = endingGrant;

    return (
      <Card
        ariaLabelledBy="home-grant"
        className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-signal/35 bg-signal-soft px-5 py-3.5"
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-signal-text" id="home-grant">
            {COPY.grantEnding.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground">
            {COPY.grantEnding.copy(left, dayText(expiresAt))}
          </p>
        </div>
        <Button asChild size="sm" variant="primary">
          <Link to="/profile/billing">{COPY.grantEnding.choosePlan}</Link>
        </Button>
      </Card>
    );
  }

  if (applicationsLeft === 0 && planApplications > 0) {
    return (
      <Card
        ariaLabelledBy="home-out"
        className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-need bg-need-soft px-5 py-4"
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-need" id="home-out">
            {COPY.outOfApplications.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground">
            {COPY.outOfApplications.copy}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="primary">
            <Link to="/profile/billing">{COPY.outOfApplications.choosePlan}</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to="/board">{COPY.outOfApplications.seeBoard}</Link>
          </Button>
        </div>
      </Card>
    );
  }

  return null;
}
