import type { CompanyBrandKey } from "./company-brands-data.ts";

import { Card } from "../ui/card.tsx";
import { dsBody, dsDisplayCardTitle, dsEyebrow, dsMono } from "../ui/ds.ts";
import { CompanyBrandTile } from "./company-brands.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

const discoveryPostings: readonly {
  age: string;
  brandKey: CompanyBrandKey;
  company: string;
  location: string;
  title: string;
}[] = [
  {
    age: "Just now",
    brandKey: "shopify",
    company: "Shopify",
    location: "Toronto, ON · Remote",
    title: "Merchant Operations Manager",
  },
  {
    age: "1m ago",
    brandKey: "stripe",
    company: "Stripe",
    location: "New York, NY · Hybrid",
    title: "Financial Planning Analyst",
  },
  {
    age: "2m ago",
    brandKey: "nike",
    company: "Nike",
    location: "Portland, OR · Hybrid",
    title: "Brand Marketing Manager",
  },
  {
    age: "4m ago",
    brandKey: "hsbc",
    company: "HSBC",
    location: "London, UK · Hybrid",
    title: "Compliance & Risk Advisor",
  },
  {
    age: "6m ago",
    brandKey: "spotify",
    company: "Spotify",
    location: "Stockholm, Sweden",
    title: "People & Culture Partner",
  },
  {
    age: "9m ago",
    brandKey: "emirates",
    company: "Emirates",
    location: "Dubai, UAE",
    title: "Aviation Operations Coordinator",
  },
];

export function LandingStepFeedCard({ active }: { active: boolean }) {
  const cardClass = active
    ? "relative z-10 flex h-full min-w-0 flex-col gap-0 overflow-hidden border-signal p-0 transition duration-300 -translate-y-0.5 shadow-lift"
    : "relative z-10 flex h-full min-w-0 flex-col gap-0 overflow-hidden p-0 transition duration-300 hover:-translate-y-0.5 hover:border-foreground/30";

  return (
    <Card className={cardClass}>
      <div className="flex flex-1 flex-col gap-3 bg-muted/55 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className={dsEyebrow}>{LANDING_COPY.howItWorks.step1.feedLabel}</span>
          <span className={`${dsMono} inline-flex items-center gap-1.5`}>
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            {LANDING_COPY.howItWorks.step1.refresh}
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-between divide-y divide-border/70 overflow-hidden rounded-lg bg-card">
          {discoveryPostings.map((posting, idx) => (
            <div
              className={`flex items-center gap-3.5 px-3.5 py-2.5 ${idx === 0 ? "bg-signal-soft/35" : ""}`}
              key={posting.title}
            >
              <CompanyBrandTile brandKey={posting.brandKey} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-serif text-base leading-tight text-foreground">
                  {posting.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {`${posting.company} · ${posting.location}`}
                </p>
              </div>
              <span
                className={
                  idx === 0
                    ? "inline-flex flex-none items-center gap-1.5 font-mono text-xs font-medium text-signal-text"
                    : "flex-none font-mono text-xs text-muted-foreground"
                }
              >
                {idx === 0 ? <span className="h-1.5 w-1.5 rounded-full bg-signal" /> : null}
                {posting.age}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border px-5 py-4 sm:px-6">
        <h3 className={dsDisplayCardTitle}>{LANDING_COPY.howItWorks.step1.title}</h3>
        <p className={`${dsBody} mt-1.5 max-w-lg`}>{LANDING_COPY.howItWorks.step1.body}</p>
      </div>
    </Card>
  );
}
