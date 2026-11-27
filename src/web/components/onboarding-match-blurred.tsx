import { Lock } from "lucide-react";

import type { OnboardingMatchView } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { dsMetric } from "./ui/ds.ts";

const text = copy.onboarding.matches;

export function OnboardingMatchBlurred({
  body,
  matches,
  remainingCount,
}: {
  body?: string | undefined;
  matches: readonly OnboardingMatchView[];
  remainingCount: number;
}) {
  if (matches.length === 0 && remainingCount <= 0) {
    return null;
  }

  return (
    <div className="relative mt-4 overflow-hidden rounded-lg border border-border bg-card">
      <div
        aria-hidden="true"
        className="pointer-events-none select-none space-y-2.5 p-3.5 opacity-60 blur-xs"
      >
        {matches.map((match) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3.5"
            key={match.id}
          >
            <div className="flex min-w-0 items-center gap-3">
              <CompanyAvatar company={match.company} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{match.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {`${match.company} · ${match.location ?? text.remote}`}
                </p>
              </div>
            </div>
            <p className={`${dsMetric} shrink-0 text-signal-text tabular-nums`}>
              {String(match.score)}
            </p>
          </div>
        ))}
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-card via-card/90 to-card/55 p-4">
        <div className="max-w-sm rounded-lg border border-border bg-card px-4 py-3 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Lock aria-hidden="true" className="text-signal-text" size={14} />
            <span>{text.moreMatchesTitle(remainingCount)}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {body ?? text.moreMatchesBody}
          </p>
        </div>
      </div>
    </div>
  );
}
