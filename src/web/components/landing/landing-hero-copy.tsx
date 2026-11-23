import { ArrowRight } from "lucide-react";

import { Button } from "../ui/button.tsx";
import { dsLead } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";
import { LandingLiveCounter } from "./landing-live-counter.tsx";

export function LandingHeroCopy() {
  return (
    <div>
      <h1 className="space-y-1 font-serif text-hero font-normal text-foreground">
        <span className="block">{LANDING_COPY.hero.headlinePlain}</span>
        <span className="block italic text-signal">{LANDING_COPY.hero.headlineItalic}</span>
      </h1>
      <p className={`${dsLead} mt-5 max-w-lg sm:mt-6`}>{LANDING_COPY.hero.lead}</p>
      <div className="mt-7 grid grid-cols-2 gap-3 sm:mt-8 sm:flex sm:flex-wrap sm:items-center sm:gap-3.5">
        <Button asChild size="lg" variant="primary">
          <a href="/signup">
            <span>{LANDING_COPY.hero.ctaPrimary}</span>
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <a href="#how-it-works">{LANDING_COPY.hero.ctaSecondary}</a>
        </Button>
      </div>
      <LandingLiveCounter />
    </div>
  );
}
