import { Check, MapPin } from "lucide-react";

import type { OnboardingMatchView } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { dsEyebrow, dsMetric } from "./ui/ds.ts";

const text = copy.onboarding.matches;

const moneyFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const PERIOD_WORD = { hour: "hour", month: "month", year: "year" } as const;

function salaryText(match: OnboardingMatchView) {
  if (match.salaryMinMinor === null || match.salaryCurrency === null) {
    return text.noSalary;
  }

  const amount = moneyFormat.format(Math.round(match.salaryMinMinor / 100));
  const period = match.salaryPeriod === null ? "" : ` per ${PERIOD_WORD[match.salaryPeriod]}`;

  return `${match.salaryCurrency} ${amount}${period}`;
}

export function OnboardingMatchItem({
  disabled,
  match,
  on,
  onToggle,
}: {
  disabled: boolean;
  match: OnboardingMatchView;
  on: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <li
      className={`rounded-xl border p-4 transition ${
        on ? "border-signal bg-signal-soft" : "border-border bg-background"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{match.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {`${match.company} · ${match.location ?? text.remote}`}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin aria-hidden="true" size={12} />
            <span>{salaryText(match)}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            aria-label={text.scoreAria(match.score)}
            className={`${dsMetric} text-signal-text tabular-nums`}
          >
            {String(match.score)}
          </p>
          <p className="text-xs text-muted-foreground">
            {match.strong ? text.strong : text.scoreLabel}
          </p>
        </div>
      </div>

      {match.why.length === 0 ? null : (
        <div className="mt-3 border-t border-border pt-3">
          <p className={dsEyebrow}>{text.whyTitle}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {match.why.map((reason) => (
              <li className="flex items-start gap-1.5 text-xs text-foreground" key={reason}>
                <Check aria-hidden="true" className="mt-0.5 shrink-0 text-ok" size={12} />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Button
          ariaLabel={
            on
              ? text.selectedOne(match.title, match.company)
              : text.pickOne(match.title, match.company)
          }
          ariaPressed={on}
          className="min-h-11"
          disabled={disabled}
          onClick={() => {
            onToggle(match.id);
          }}
          size="sm"
          variant={on ? "primary" : "outline"}
        >
          {on ? text.selected : text.select}
        </Button>
      </div>
    </li>
  );
}
