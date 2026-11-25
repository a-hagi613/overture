import { Briefcase, Check } from "lucide-react";

import type { OnboardingMatchView } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Button } from "./ui/button.tsx";

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
      className={`rounded-lg border p-4 transition ${
        on ? "border-signal/60 bg-signal-soft/30" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <CompanyAvatar company={match.company} size="sm" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">{match.title}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {`${match.company} · ${match.location ?? text.remote}`}
            </p>
          </div>
        </div>
        <div
          aria-label={text.scoreAria(match.score)}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-signal/30 bg-signal-soft/70 px-2.5 py-1"
        >
          <span className="text-sm font-bold text-signal-text tabular-nums">
            {String(match.score)}
          </span>
          <span aria-hidden="true" className="h-3.5 w-px bg-signal/30" />
          <span className="text-xs font-medium text-foreground">
            {match.strong ? text.strong : text.scoreLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 border-t border-border pt-3">
        <div
          aria-label={match.why.length > 0 ? text.whyTitle : undefined}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
        >
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Briefcase aria-hidden="true" size={12} />
            <span>{salaryText(match)}</span>
          </span>
          {match.why.map((reason) => (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-ok-soft/60 px-2 py-1 text-xs font-medium text-foreground"
              key={reason}
            >
              <Check aria-hidden="true" className="shrink-0 text-ok" size={12} />
              <span>{reason}</span>
            </span>
          ))}
        </div>
        <Button
          ariaLabel={
            on
              ? text.selectedOne(match.title, match.company)
              : text.pickOne(match.title, match.company)
          }
          ariaPressed={on}
          className="shrink-0"
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
