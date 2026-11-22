import { Link } from "react-router";

import type { HomeResponse } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { dayText } from "../lib/billing-format.ts";

const COPY = copy.home;

const BUTTON_CLASS =
  "inline-flex min-h-10 max-[767px]:min-h-11 flex-none items-center justify-center rounded-md border border-foreground bg-foreground px-[18px] text-[13.5px] font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover";

const SECONDARY_CLASS =
  "inline-flex min-h-10 max-[767px]:min-h-11 flex-none items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold text-foreground hover:bg-muted";

/**
 * Home's billing notices with their fix: Applications have run out, or an
 * invite grant with an end date still holds Applications.
 * @param props The Applications left, the plan total and the invite grant.
 * @returns The notice, or null when neither state applies.
 */
export function HomeBillingNotice(props: {
  applicationsLeft: number;
  endingGrant: HomeResponse["endingGrant"];
  planApplications: number;
}) {
  const { applicationsLeft, endingGrant, planApplications } = props;

  if (endingGrant !== null) {
    const { applicationsLeft: left, expiresAt } = endingGrant;

    return (
      <section
        aria-labelledby="home-grant"
        className="mt-[22px] flex flex-wrap items-center justify-between gap-x-5 gap-y-3.5 rounded-lg border border-input bg-card px-5 py-4"
      >
        <div className="min-w-0 flex-[1_1_360px]">
          <h2 className="text-sm font-bold leading-[1.45]" id="home-grant">
            {COPY.grantEnding.title}
          </h2>
          <p className="mt-1 text-sm leading-[1.45] text-foreground">
            {COPY.grantEnding.copy(left, dayText(expiresAt))}
          </p>
        </div>
        <Link className={BUTTON_CLASS} to="/settings/billing/plans">
          {COPY.grantEnding.choosePlan}
        </Link>
      </section>
    );
  }

  if (applicationsLeft === 0 && planApplications > 0) {
    return (
      <section
        aria-labelledby="home-out"
        className="mt-[22px] flex flex-wrap items-center justify-between gap-x-5 gap-y-3.5 rounded-lg border border-need bg-need-soft px-5 py-4"
      >
        <div className="min-w-0 flex-[1_1_360px]">
          <h2 className="text-sm font-bold leading-[1.45]" id="home-out">
            {COPY.outOfApplications.title}
          </h2>
          <p className="mt-1 text-sm leading-[1.45] text-foreground">
            {COPY.outOfApplications.copy}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link className={BUTTON_CLASS} to="/settings/billing/plans">
            {COPY.outOfApplications.choosePlan}
          </Link>
          <Link className={SECONDARY_CLASS} to="/board">
            {COPY.outOfApplications.seeBoard}
          </Link>
        </div>
      </section>
    );
  }

  return null;
}
