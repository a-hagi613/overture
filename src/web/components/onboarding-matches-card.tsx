import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "react-router";

import type { OnboardingMatches } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { OnboardingMatchItem } from "./onboarding-match-item.tsx";
import { OnboardingMatchesEmpty } from "./onboarding-matches-empty.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

const text = copy.onboarding.matches;

export function OnboardingMatchesCard({
  backTo,
  busy,
  failed,
  matches,
  onContinue,
  onToggle,
  selected,
}: {
  backTo: string;
  busy: boolean;
  failed: boolean;
  matches: OnboardingMatches;
  onContinue: () => Promise<void> | void;
  onToggle: (id: string) => void;
  selected: readonly string[];
}) {
  const full = selected.length >= matches.pickLimit;

  return (
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-8" variant="elevated">
      <h2 className={dsCardTitle} id="ob-h">
        {`${text.titlePlain} ${text.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-2 max-w-xl`}>{text.intro}</p>

      {matches.matches.length === 0 ? (
        <OnboardingMatchesEmpty backTo={backTo} />
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <p className={`${dsEyebrow} tabular-nums`}>{text.poolCount(matches.poolCount)}</p>
            <output className="text-xs font-semibold text-foreground tabular-nums">
              {text.pickNote(selected.length, matches.pickLimit)}
            </output>
          </div>

          <ul className="mt-3 flex flex-col gap-3">
            {matches.matches.map((match) => {
              const on = selected.includes(match.id);

              return (
                <OnboardingMatchItem
                  disabled={!on && full}
                  key={match.id}
                  match={match}
                  on={on}
                  onToggle={onToggle}
                />
              );
            })}
          </ul>
        </>
      )}

      {failed ? (
        <p className="mt-4 text-xs font-semibold text-need" role="alert">
          {text.saveFailed}
        </p>
      ) : null}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <Button asChild size="default" variant="ghost">
          <Link to={backTo}>
            <ArrowLeft aria-hidden="true" size={15} />
            <span>{text.back}</span>
          </Link>
        </Button>
        <Button
          ariaBusy={busy}
          disabled={busy || selected.length === 0}
          onClick={() => {
            void onContinue();
          }}
          size="lg"
          variant="primary"
        >
          <span>{text.continue(matches.pickLimit)}</span>
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">{text.limitNote}</p>
    </Card>
  );
}
