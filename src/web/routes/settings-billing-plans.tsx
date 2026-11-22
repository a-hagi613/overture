import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { BillingPlan } from "../lib/billing-api.ts";

import { PLANS } from "../../shared/plans.ts";
import { copy } from "../../shared/copy.ts";
import { BillingPlanOption } from "../components/billing-plan-option.tsx";
import { BillingReturnNotice } from "../components/billing-return-notice.tsx";
import { BILLING_BUTTON_SECONDARY } from "../components/billing-classes.ts";
import { PageHeader } from "../components/page-header.tsx";
import { startCheckout, useBilling } from "../lib/billing-api.ts";

const COPY = copy.billingPlans;

const PLAN_NAME: Record<BillingPlan, string> = { month: COPY.monthName, week: COPY.weekName };

export function SettingsBillingPlansPage() {
  const [params] = useSearchParams();
  const returned = params.get("billing");
  const checkingReturn = returned === "success";

  const { data: billing, isError } = useBilling({
    refetchInterval: checkingReturn ? 3000 : false,
  });

  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);

  async function choose(plan: BillingPlan) {
    setStarting(true);
    setStartFailed(false);

    try {
      globalThis.location.assign(await startCheckout(plan));
    } catch {
      setStartFailed(true);
      setStarting(false);
    }
  }

  function chooseFrom(plan: BillingPlan) {
    void choose(plan);
  }

  const confirmedPlan = billing?.plan ?? null;

  let notice = null;

  if (checkingReturn && confirmedPlan !== null) {
    const terms = PLANS[confirmedPlan];

    notice = (
      <BillingReturnNotice
        body={COPY.startedBody(PLAN_NAME[confirmedPlan], terms.applications, terms.periodDays)}
        line={COPY.startedLine(PLAN_NAME[confirmedPlan])}
        title={COPY.startedTitle}
      />
    );
  } else if (checkingReturn) {
    notice = (
      <BillingReturnNotice
        body={COPY.checkingBody}
        line={COPY.checkingLine}
        title={COPY.checkingTitle}
      />
    );
  } else if (returned === "cancelled") {
    notice = (
      <BillingReturnNotice
        body={COPY.cancelledBody}
        line={COPY.cancelledLine}
        title={COPY.cancelledTitle}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[940px]">
      <Link
        className="inline-flex max-md:min-h-11 max-md:-my-[14px] items-center text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        to="/settings/billing"
      >
        {`← ${COPY.backLink}`}
      </Link>
      <PageHeader
        lead={COPY.lead}
        titleNode={
          <>
            {COPY.titlePlain} <span className="italic">{COPY.titleItalic}</span>
          </>
        }
      />
      {notice}
      {checkingReturn && confirmedPlan !== null ? (
        <p className="mt-5">
          <Link className={BILLING_BUTTON_SECONDARY} to="/">
            {COPY.goHome}
          </Link>
        </p>
      ) : null}
      {isError ? (
        <p className="mt-7 text-sm text-need" role="alert">
          {COPY.unavailable}
        </p>
      ) : (
        <div className="mt-7 flex flex-col gap-5 min-[900px]:flex-row">
          <BillingPlanOption disabled={starting} onChoose={chooseFrom} plan="week" />
          <BillingPlanOption disabled={starting} onChoose={chooseFrom} plan="month" />
        </div>
      )}
      {startFailed ? (
        <p className="mt-4 text-[12.5px] text-need" role="alert">
          {COPY.startError}
        </p>
      ) : null}
    </div>
  );
}
