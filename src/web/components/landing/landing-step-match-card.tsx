import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { dsBody, dsDisplayCardTitle, dsMono } from "../ui/ds.ts";
import { CompanyBrandTile } from "./company-brands.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

export function LandingStepMatchCard({ active }: { active: boolean }) {
  const cardClass = active
    ? "relative z-10 flex h-full min-w-0 flex-col gap-0 overflow-hidden border-signal p-0 transition duration-300 -translate-y-0.5 shadow-lift"
    : "relative z-10 flex h-full min-w-0 flex-col gap-0 overflow-hidden p-0 transition duration-300 hover:-translate-y-0.5 hover:border-foreground/30";

  return (
    <Card className={cardClass}>
      <div className="flex flex-1 flex-col justify-center bg-muted/55 px-5 py-4">
        <div className="rounded-lg bg-card px-4 py-3.5">
          <div className="flex items-center gap-3.5">
            <CompanyBrandTile brandKey="shopify" size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif text-card-title leading-tight text-foreground">
                {LANDING_COPY.howItWorks.step2.role}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {LANDING_COPY.howItWorks.step2.companyMeta}
              </p>
            </div>
            <figure aria-label="Match 94" className="relative m-0 h-14 w-14 flex-none">
              <svg
                aria-hidden="true"
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 96 96"
              >
                <circle
                  className="stroke-input"
                  cx="48"
                  cy="48"
                  fill="none"
                  r="42"
                  strokeWidth="3.5"
                />
                <circle
                  className="stroke-signal"
                  cx="48"
                  cy="48"
                  fill="none"
                  r="42"
                  strokeDasharray="248.1 263.9"
                  strokeLinecap="round"
                  strokeWidth="3.8"
                  transform="rotate(-90 48 48)"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-serif text-card-title leading-none tabular-nums text-signal-text">
                {LANDING_COPY.howItWorks.step2.score}
              </span>
            </figure>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
            <div className="flex items-center gap-2">
              <Badge variant="ok">{LANDING_COPY.howItWorks.step2.badge}</Badge>
              <span className="text-xs text-muted-foreground">
                {LANDING_COPY.howItWorks.step2.skills}
              </span>
            </div>
            <span className={`${dsMono} text-signal-text`}>
              {LANDING_COPY.howItWorks.step2.preparing}
            </span>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-5 py-4 sm:px-6">
        <h3 className={dsDisplayCardTitle}>{LANDING_COPY.howItWorks.step2.title}</h3>
        <p className={`${dsBody} mt-1.5`}>{LANDING_COPY.howItWorks.step2.body}</p>
      </div>
    </Card>
  );
}
