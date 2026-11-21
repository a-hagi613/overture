import type { SalaryPeriodWord } from "../../shared/onboarding.ts";

import { copy } from "../../shared/copy.ts";
import { SALARY_PERIOD_WORDS } from "../../shared/onboarding.ts";
import { OnboardingSelectField } from "./onboarding-select-field.tsx";

export interface SalaryDraft {
  amount: string;
  period: SalaryPeriodWord | "";
}

export function OnboardingSalaryRow({
  commitAmount,
  commitPeriod,
  currency,
  entry,
  onChange,
}: {
  commitAmount: (amount: string) => void;
  commitPeriod: (period: SalaryPeriodWord | "") => void;
  currency: string;
  entry: SalaryDraft;
  onChange: (patch: Partial<SalaryDraft>) => void;
}) {
  return (
    <>
      <span className="mono text-[13px] text-muted-foreground">{currency}</span>
      <input
        aria-label={copy.onboarding.salaryFor(currency)}
        className="inp num"
        inputMode="numeric"
        onBlur={() => {
          commitAmount(entry.amount);
        }}
        onChange={(event) => {
          onChange({ amount: event.target.value });
        }}
        placeholder={copy.onboarding.salaryAmount}
        value={entry.amount}
      />
      <OnboardingSelectField
        ariaLabel={copy.onboarding.salaryPeriodFor(currency)}
        id={`sal-${currency.toLowerCase()}-p`}
        onChange={(value) => {
          const period = SALARY_PERIOD_WORDS.find((word) => word === value) ?? "";

          onChange({ period });
          commitPeriod(period);
        }}
        options={SALARY_PERIOD_WORDS}
        placeholder={copy.onboarding.choose}
        value={entry.period}
      />
    </>
  );
}
