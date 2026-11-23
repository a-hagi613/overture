import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { dsBody, dsCardTitle, dsMono } from "../ui/ds.ts";
import { CompanyBrandTile } from "./company-brands.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

export function LandingStepAppliedCard({ active }: { active: boolean }) {
  const cardClass = active
    ? "relative z-10 flex h-full min-w-0 flex-col gap-4 border-signal p-4 transition duration-300 -translate-y-0.5 shadow-lift sm:p-5"
    : "relative z-10 flex h-full min-w-0 flex-col gap-4 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-signal sm:p-5";

  return (
    <Card className={cardClass}>
      <div className="flex flex-1 flex-col justify-center gap-3 overflow-hidden rounded-lg border border-border bg-muted p-4">
        <div className="rounded-lg border border-signal bg-card px-4 py-3.5 shadow-sh">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <CompanyBrandTile brandKey="shopify" size="sm" />
              <div className="min-w-0">
                <p className="truncate font-serif text-base leading-tight text-foreground">
                  {LANDING_COPY.howItWorks.step3.role}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {LANDING_COPY.howItWorks.step3.meta}
                </p>
              </div>
            </div>
            <Badge variant="signal">{LANDING_COPY.howItWorks.step3.appliedBadge}</Badge>
          </div>
          <p className="mt-2.5 border-t border-border pt-2.5 font-serif text-sm leading-snug text-muted-foreground">
            {LANDING_COPY.howItWorks.step3.quote}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{LANDING_COPY.howItWorks.step3.coverBadge}</Badge>
            <Badge variant="ok">{LANDING_COPY.howItWorks.step3.answersBadge}</Badge>
          </div>
          <span className={dsMono}>{LANDING_COPY.howItWorks.step3.confirmed}</span>
        </div>
      </div>
      <div>
        <h3 className={dsCardTitle}>{LANDING_COPY.howItWorks.step3.title}</h3>
        <p className={`${dsBody} mt-1.5`}>{LANDING_COPY.howItWorks.step3.body}</p>
      </div>
    </Card>
  );
}
