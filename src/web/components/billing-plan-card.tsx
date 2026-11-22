import { Link } from "react-router";

import type { BillingState } from "../lib/billing-api.ts";

import { copy } from "../../shared/copy.ts";
import { renewalText } from "../lib/billing-format.ts";
import { BILLING_BUTTON_PRIMARY, BILLING_CARD } from "./billing-classes.ts";

const COPY = copy.settingsBilling;

/**
 * The current plan with its Applications left and renewal date, or the
 * choice of a plan when there is none.
 * @param props The billing state from the server.
 * @returns The plan card section.
 */
export function BillingPlanCard(props: { billing: BillingState }) {
  const { billing } = props;

  if (billing.plan === null) {
    return (
      <section aria-labelledby="billing-plan" className={BILLING_CARD}>
        <h2 className="font-serif text-[26px] leading-[1.1]" id="billing-plan">
          {COPY.planHeading}
        </h2>
        <p className="mt-3 text-sm font-semibold">{COPY.noPlanTitle}</p>
        <p className="text-[12.5px] text-muted-foreground">{COPY.noPlanDetail}</p>
        <div className="mt-3">
          <Link className={BILLING_BUTTON_PRIMARY} to="/settings/billing/plans">
            {COPY.choosePlan}
          </Link>
        </div>
      </section>
    );
  }

  const planName = billing.plan === "week" ? COPY.weekPlan : COPY.monthPlan;
  const planDetail = billing.plan === "week" ? COPY.weekDetail : COPY.monthDetail;

  return (
    <section aria-labelledby="billing-plan" className={BILLING_CARD}>
      <h2 className="font-serif text-[26px] leading-[1.1]" id="billing-plan">
        {COPY.planHeading}
      </h2>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{planName}</p>
          <p className="text-[12.5px] text-muted-foreground">{planDetail}</p>
        </div>
        <div className="text-right">
          <p className="text-[12.5px] text-muted-foreground">{COPY.leftHeading}</p>
          <p className="font-serif text-[40px] leading-none tabular-nums">
            {billing.applicationsLeft}
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            {COPY.leftOf(billing.planApplications)}
          </p>
        </div>
      </div>
      {billing.currentPeriodEnd === null ? null : (
        <p className="mt-3 border-t border-border pt-3.5 text-[12.5px] text-muted-foreground">
          {COPY.renews}{" "}
          <time dateTime={new Date(billing.currentPeriodEnd).toISOString()}>
            {renewalText(billing.currentPeriodEnd)}
          </time>
        </p>
      )}
    </section>
  );
}
