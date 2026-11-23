import { Check } from "lucide-react";

import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { dsBody, dsCardTitle, dsContainer, dsMetric, dsMono, dsSectionHeading } from "../ui/ds.ts";
import { Separator } from "../ui/separator.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

const TIERS = [
  { ...LANDING_COPY.pricing.free, badgeVariant: "outline" as const, featured: false },
  { ...LANDING_COPY.pricing.week, badgeVariant: "ok" as const, featured: false },
  { ...LANDING_COPY.pricing.month, badgeVariant: "signal" as const, featured: true },
] as const;

export function LandingPricingSection() {
  return (
    <section
      aria-labelledby="pricing-title"
      className="border-y border-border bg-sidebar"
      id="pricing"
    >
      <div className={`${dsContainer} py-16 sm:py-24`}>
        <div className="mx-auto max-w-2xl text-center">
          <Badge asChild size="eyebrow" variant="signal">
            <a href="#pricing">{LANDING_COPY.pricing.badge}</a>
          </Badge>
          <h2 className={`${dsSectionHeading} mt-4`} id="pricing-title">
            {LANDING_COPY.pricing.headingPlain}
            <span className="italic">{LANDING_COPY.pricing.headingItalic}</span>
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
          {TIERS.map((tier) => (
            <Card
              className={
                tier.featured
                  ? "relative flex flex-col overflow-hidden border-signal p-6 ring-1 ring-signal sm:p-8"
                  : "flex flex-col p-6 sm:p-8"
              }
              key={tier.name}
              variant={tier.featured ? "elevated" : "default"}
            >
              {tier.featured ? (
                <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-signal" />
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <h3 className={dsCardTitle}>{tier.name}</h3>
                <Badge variant={tier.badgeVariant}>{tier.badge}</Badge>
              </div>
              <p className={`${dsBody} mt-2 sm:min-h-10`}>{tier.lead}</p>
              <div className="my-5 flex items-baseline gap-2">
                <span className={tier.featured ? `${dsMetric} text-signal-text` : dsMetric}>
                  {tier.price}
                </span>
                <span className={dsMono}>{tier.unit}</span>
              </div>
              <Separator />
              <ul className="mb-7 mt-5 flex list-none flex-col gap-3 p-0 text-sm text-foreground">
                {tier.bullets.map((bullet) => (
                  <li className="flex gap-3" key={bullet}>
                    <Check
                      aria-hidden="true"
                      className={`mt-0.5 h-4 w-4 flex-none ${
                        tier.featured ? "text-signal-text" : "text-ok"
                      }`}
                    />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className="mt-auto w-full"
                variant={tier.featured ? "primary" : "secondary"}
              >
                <a href="/signup">{tier.cta}</a>
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
