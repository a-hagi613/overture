import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { dsBody, dsDisplayCardTitle, dsMono } from "../ui/ds.ts";
import { CompanyBrandTile } from "./company-brands.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

export function LandingStepAppliedCard({ active }: { active: boolean }) {
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
                {LANDING_COPY.howItWorks.step3.role}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {LANDING_COPY.howItWorks.step3.meta}
              </p>
            </div>
            <Badge variant="signal">{LANDING_COPY.howItWorks.step3.appliedBadge}</Badge>
          </div>
          <p className="mt-2.5 font-serif text-sm italic leading-snug text-muted-foreground">
            {LANDING_COPY.howItWorks.step3.quote}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{LANDING_COPY.howItWorks.step3.coverBadge}</Badge>
              <Badge variant="ok">{LANDING_COPY.howItWorks.step3.answersBadge}</Badge>
            </div>
            <span className={dsMono}>{LANDING_COPY.howItWorks.step3.confirmed}</span>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-5 py-4 sm:px-6">
        <h3 className={dsDisplayCardTitle}>{LANDING_COPY.howItWorks.step3.title}</h3>
        <p className={`${dsBody} mt-1.5`}>{LANDING_COPY.howItWorks.step3.body}</p>
      </div>
    </Card>
  );
}
