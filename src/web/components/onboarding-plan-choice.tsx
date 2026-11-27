import type { OnboardingPlanKind } from "../../shared/onboarding.ts";

import { copy } from "../../shared/copy.ts";
import { cn } from "./ui/cn.ts";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

const text = copy.onboarding.plan;

interface PlanOption {
  applications: string;
  detail: string;
  kind: OnboardingPlanKind;
  name: string;
  price: string;
  sending: string;
  unit: string | null;
}

const OPTIONS: readonly PlanOption[] = [
  {
    applications: text.trialApplications,
    detail: text.trialCard,
    kind: "free_trial",
    name: text.trialName,
    price: text.trialPrice,
    sending: text.trialSending,
    unit: null,
  },
  {
    applications: text.weekApplications,
    detail: text.paidDaily,
    kind: "week",
    name: text.weekName,
    price: text.weekPrice,
    sending: text.paidSending,
    unit: text.weekUnit,
  },
  {
    applications: text.monthApplications,
    detail: text.paidDaily,
    kind: "month",
    name: text.monthName,
    price: text.monthPrice,
    sending: text.paidSending,
    unit: text.monthUnit,
  },
];

/**
 * The three onboarding plans, side by side on desktop and stacked on a phone. Each is a native radio, so
 * keyboard and screen-reader users get the same choice as a pointer user.
 * @param props The selected plan, the available plans and the change handler.
 * @returns The plan fieldset.
 */
export function OnboardingPlanChoice(props: {
  disabled: boolean;
  onSelect: (planKind: OnboardingPlanKind) => void;
  planKind: OnboardingPlanKind;
  trialAvailable: boolean;
}) {
  const { disabled, onSelect, planKind, trialAvailable } = props;

  return (
    <fieldset className="mt-6 rounded-xl border border-border bg-muted/30 p-4 md:p-5">
      <legend className={`${dsEyebrow} px-1`}>{text.legend}</legend>
      <p className={`${dsBody} mt-1`}>{text.intro}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {OPTIONS.map((option) => {
          const unavailable = option.kind === "free_trial" && !trialAvailable;
          const selected = planKind === option.kind;

          return (
            <label
              className={cn(
                "flex cursor-pointer flex-col rounded-lg border bg-card p-4 transition duration-quick ease-out",
                selected ? "border-signal ring-1 ring-signal" : "border-border hover:border-input",
                unavailable && "cursor-not-allowed opacity-60 hover:border-border",
              )}
              key={option.kind}
            >
              <span className="flex items-center gap-2">
                <input
                  checked={selected}
                  className="h-4 w-4 flex-none accent-signal"
                  disabled={disabled || unavailable}
                  name="onboarding-plan"
                  onChange={() => {
                    if (!unavailable) {
                      onSelect(option.kind);
                    }
                  }}
                  type="radio"
                  value={option.kind}
                />
                <span className="truncate text-sm font-semibold text-foreground">
                  {option.name}
                </span>
              </span>

              <span className="mt-1.5 flex items-baseline gap-1 whitespace-nowrap">
                <span className={dsCardTitle}>{option.price}</span>
                {option.unit === null ? null : (
                  <span className="text-xs text-muted-foreground">{option.unit}</span>
                )}
              </span>

              <span className="mt-2 block text-xs font-medium text-foreground">
                {option.applications}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{option.detail}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{option.sending}</span>
              {option.kind === "free_trial" && trialAvailable ? (
                <span className="mt-2 block text-xs text-muted-foreground">
                  {text.trialPreselected}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      {trialAvailable ? null : (
        <output className="mt-3 block text-xs font-medium text-need">{text.trialUsedNotice}</output>
      )}
    </fieldset>
  );
}
