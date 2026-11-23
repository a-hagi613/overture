import type { SalaryPeriodWord } from "../../shared/onboarding.ts";

import { copy } from "../../shared/copy.ts";
import { SALARY_PERIOD_WORDS } from "../../shared/onboarding.ts";
import { OnboardingSelectField } from "./onboarding-select-field.tsx";
import { Input } from "./ui/input.tsx";

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
    <div className="grid grid-cols-[52px_minmax(0,1fr)_172px] items-center gap-2.5">
      <span className="font-mono text-xs font-semibold text-muted-foreground">{currency}</span>
      <Input
        ariaLabel={copy.onboarding.salaryFor(currency)}
        className="tabular-nums"
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
    </div>
  );
}
