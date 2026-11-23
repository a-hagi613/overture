import { Plus } from "lucide-react";

import { Badge } from "../ui/badge.tsx";
import { dsBody, dsCardTitle, dsContainer, dsLead, dsSectionHeading } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";

export function LandingFaqSection() {
  return (
    <section aria-labelledby="faq-title" className={`${dsContainer} py-16 sm:py-24`} id="faq">
      <div className="grid grid-cols-1 items-start gap-x-20 gap-y-8 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Badge size="eyebrow" variant="signal">
            {LANDING_COPY.faq.badge}
          </Badge>
          <h2 className={`${dsSectionHeading} mt-4`} id="faq-title">
            {LANDING_COPY.faq.headingPlain}
            <span className="italic">{LANDING_COPY.faq.headingItalic}</span>
          </h2>
          <p className={`${dsLead} mt-4`}>{LANDING_COPY.faq.lead}</p>
        </div>
        <div className="lg:col-span-8">
          {LANDING_COPY.faq.items.map((item, index) => (
            <details
              className={`group border-t border-border ${
                index === LANDING_COPY.faq.items.length - 1 ? "border-b" : ""
              }`}
              key={item.q}
              open={item.open}
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 py-6 transition hover:text-signal-text [&::-webkit-details-marker]:hidden">
                <span className={dsCardTitle}>{item.q}</span>
                <Plus
                  aria-hidden="true"
                  className="h-5 w-5 flex-none text-foreground transition-transform duration-300 group-open:rotate-45"
                />
              </summary>
              <p className={`${dsBody} pb-6 sm:pr-10 sm:text-base`}>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
