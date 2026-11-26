import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import type { HomeResponse } from "../lib/home-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";
import { StatusStrip } from "./ui/status-strip.tsx";

const COPY = copy.home;

export function HomeBillingNotice(props: {
  applicationsLeft: number;
  planApplications: number;
  planKind: HomeResponse["planKind"];
  trialUsed: boolean;
}) {
  const { applicationsLeft, planApplications, planKind, trialUsed } = props;

  if (planKind === "trial" && trialUsed) {
    return (
      <Card
        ariaLabelledBy="home-trial-used"
        className="mt-3 border-foreground/20 p-4 sm:p-5"
        dataTestId="home-trial-used"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className={dsEyebrow}>{COPY.trialUsed.eyebrow}</p>
            <h2 className={`${dsCardTitle} mt-1`} id="home-trial-used">
              {COPY.trialUsed.title}
            </h2>
            <p className={`${dsBody} mt-1`}>{COPY.trialUsed.body}</p>
          </div>
          <Button
            asChild
            className="shrink-0 self-start sm:self-auto"
            size="default"
            variant="primary"
          >
            <Link to="/profile/billing">{COPY.trialUsed.cta}</Link>
          </Button>
        </div>
      </Card>
    );
  }

  if (applicationsLeft > 0 || planApplications === 0) {
    return null;
  }

  return (
    <StatusStrip
      action={
        <Button asChild size="sm" variant="primary">
          <Link to="/profile/billing">{COPY.outOfApplications.choosePlan}</Link>
        </Button>
      }
      ariaLabelledBy="home-out"
      className="mt-3 border-need/40"
      description={COPY.outOfApplications.copy}
      title={COPY.outOfApplications.title}
      titleId="home-out"
    />
  );
}
