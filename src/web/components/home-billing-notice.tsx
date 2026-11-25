import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { StatusStrip } from "./ui/status-strip.tsx";

const COPY = copy.home;

export function HomeBillingNotice(props: { applicationsLeft: number; planApplications: number }) {
  const { applicationsLeft, planApplications } = props;

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
