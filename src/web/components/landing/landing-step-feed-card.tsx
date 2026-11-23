import type { CompanyBrandKey } from "./company-brands-data.ts";

import { Card } from "../ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow, dsMono } from "../ui/ds.ts";
import { CompanyBrandTile } from "./company-brands.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

const discoveryPostings: readonly {
  brandKey: CompanyBrandKey;
  meta: string;
  title: string;
}[] = [
  {
    brandKey: "shopify",
    meta: "Shopify · Toronto, ON · Remote",
    title: "Merchant Operations Manager",
  },
  {
    brandKey: "stripe",
    meta: "Stripe · New York, NY · Hybrid",
    title: "Financial Planning Analyst",
  },
  { brandKey: "nike", meta: "Nike · Portland, OR · Hybrid", title: "Brand Marketing Manager" },
  { brandKey: "hsbc", meta: "HSBC · London, UK · Hybrid", title: "Compliance & Risk Advisor" },
  {
    brandKey: "spotify",
    meta: "Spotify · Stockholm, Sweden",
    title: "People & Culture Partner",
  },
  {
    brandKey: "emirates",
    meta: "Emirates · Dubai, UAE",
    title: "Aviation Operations Coordinator",
  },
];

const discoverySystems = ["Greenhouse", "Lever", "Ashby", "Personio", "Workable"] as const;

export function LandingStepFeedCard({ active }: { active: boolean }) {
  const cardClass = active
    ? "relative z-10 flex h-full min-w-0 flex-col gap-4 border-signal p-4 transition duration-300 -translate-y-0.5 shadow-lift sm:p-5"
    : "relative z-10 flex h-full min-w-0 flex-col gap-4 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-foreground/30 sm:p-5";

  return (
    <Card className={cardClass}>
      <div className="flex flex-1 flex-col justify-between gap-2 overflow-hidden rounded-lg border border-border bg-muted p-3">
        <div className="flex items-center justify-between gap-2">
          <span className={dsEyebrow}>{LANDING_COPY.howItWorks.step1.feedLabel}</span>
          <span className={`${dsMono} inline-flex items-center gap-1.5`}>
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            {LANDING_COPY.howItWorks.step1.refresh}
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-between gap-2 py-1">
          {discoveryPostings.map((posting) => (
            <div
              className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 shadow-sh"
              key={posting.title}
            >
              <CompanyBrandTile brandKey={posting.brandKey} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-serif text-base leading-tight text-foreground">
                  {posting.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">{posting.meta}</p>
              </div>
              <span className="h-1.5 w-1.5 flex-none rounded-full bg-signal" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {discoverySystems.map((system) => (
              <span
                className="rounded border border-border bg-card px-2 py-0.5 font-mono text-xs text-muted-foreground sm:border-0 sm:bg-transparent sm:p-0"
                key={system}
              >
                {system}
              </span>
            ))}
          </div>
          <span className={dsMono}>{LANDING_COPY.howItWorks.step1.foot}</span>
        </div>
      </div>
      <div>
        <h3 className={dsCardTitle}>{LANDING_COPY.howItWorks.step1.title}</h3>
        <p className={`${dsBody} mt-1.5 max-w-lg`}>{LANDING_COPY.howItWorks.step1.body}</p>
      </div>
    </Card>
  );
}
