import type { BillingPlan } from "../lib/billing-api.ts";

import { copy } from "../../shared/copy.ts";
import { BILLING_BUTTON_PRIMARY } from "./billing-classes.ts";

const COPY = copy.billingPlans;

const CARD =
  "flex flex-1 flex-col rounded-lg border border-border bg-card p-[22px_24px_20px] shadow-sh min-[900px]:basis-0";

/**
 * One plan on the Choose a plan page, with the button that starts Checkout.
 * @param props Whether choosing is disabled, the choice handler and the plan.
 * @returns The plan card.
 */
export function BillingPlanOption(props: {
  disabled: boolean;
  onChoose: (plan: BillingPlan) => void;
  plan: BillingPlan;
}) {
  const { disabled, onChoose, plan } = props;

  const isWeek = plan === "week";
  const name = isWeek ? COPY.weekName : COPY.monthName;
  const price = isWeek ? COPY.weekPrice : COPY.monthPrice;
  const unit = isWeek ? COPY.weekUnit : COPY.monthUnit;
  const detail = isWeek ? COPY.weekDetail : COPY.monthDetail;
  const choose = isWeek ? COPY.chooseWeek : COPY.chooseMonth;

  return (
    <section aria-labelledby={`plan-${plan}`} className={CARD}>
      <h2 className="font-serif text-[26px] leading-[1.1]" id={`plan-${plan}`}>
        {name}
      </h2>
      <p className="mt-3 font-serif text-[40px] leading-none tabular-nums">
        {price} <span className="text-[14px] text-muted-foreground">{unit}</span>
      </p>
      <p className="mt-3 text-[12.5px] text-muted-foreground">{detail}</p>
      <div className="mt-auto pt-4">
        <button
          className={BILLING_BUTTON_PRIMARY}
          disabled={disabled}
          onClick={() => {
            onChoose(plan);
          }}
          type="button"
        >
          {choose}
        </button>
      </div>
    </section>
  );
}
