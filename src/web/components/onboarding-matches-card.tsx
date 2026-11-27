import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { OnboardingMatches } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { OnboardingMatchBlurred } from "./onboarding-match-blurred.tsx";
import { OnboardingMatchItem } from "./onboarding-match-item.tsx";
import { OnboardingMatchesEmpty } from "./onboarding-matches-empty.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

const text = copy.onboarding.matches;

export function OnboardingMatchesCard({
  allowEmptyContinue = false,
  backTo,
  busy,
  ctaLabel,
  failed,
  intro,
  matches,
  onContinue,
  onToggle,
  paidPlan = false,
  planSlot,
  selected,
}: {
  allowEmptyContinue?: boolean | undefined;
  backTo: string;
  busy: boolean;
  ctaLabel?: string | undefined;
  failed: boolean;
  intro?: string | undefined;
  matches: OnboardingMatches;
  onContinue: () => Promise<void> | void;
  onToggle: (id: string) => void;
  paidPlan?: boolean | undefined;
  planSlot?: ReactNode;
  selected: readonly string[];
}) {
  const full = selected.length >= matches.pickLimit;
  const topMatches = matches.matches.slice(0, matches.pickLimit);
  const teaserMatches = matches.matches.slice(matches.pickLimit, matches.pickLimit + 3);
  const remainingCount = Math.max(matches.poolCount - topMatches.length, teaserMatches.length);

  let blurredPreview = teaserMatches;

  if (blurredPreview.length === 0) {
    blurredPreview = remainingCount > 0 ? topMatches.slice(0, 2) : [];
  }

  return (
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-7">
      <h2 className={dsCardTitle} id="ob-h">
        {text.titlePlain}
      </h2>
      <p className={`${dsBody} mt-1.5 max-w-xl`}>{intro ?? text.intro}</p>

      {planSlot}

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
            {topMatches.map((match) => {
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

          <OnboardingMatchBlurred
            body={paidPlan ? text.moreMatchesBodyPaid : text.moreMatchesBody}
            matches={blurredPreview}
            remainingCount={remainingCount}
          />
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
          disabled={busy || (!allowEmptyContinue && selected.length === 0)}
          onClick={() => {
            void onContinue();
          }}
          size="lg"
          variant="primary"
        >
          <span>
            {ctaLabel ??
              (selected.length > 0 ? text.applyFree(selected.length) : text.continueFallback)}
          </span>
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </Card>
  );
}
