import { Button } from "../ui/button.tsx";
import { dsBandHeading, dsContainer, dsLead } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";
import { LandingGrain } from "./landing-grain.tsx";

export function LandingClosingSection() {
  return (
    <section aria-labelledby="closing-title" className="relative border-t border-border">
      <LandingGrain variant="closing" />
      <div className={`${dsContainer} relative z-10 py-16 text-center sm:py-24`}>
        <h2 className={`${dsBandHeading} mx-auto max-w-3xl text-foreground`} id="closing-title">
          {LANDING_COPY.closing.headingPlain}
          <span className="italic">{LANDING_COPY.closing.headingItalic}</span>
        </h2>
        <p className={`${dsLead} mx-auto mt-5 max-w-lg`}>{LANDING_COPY.closing.lead}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3.5">
          <Button asChild size="lg" variant="primary">
            <a href="/signup">{LANDING_COPY.closing.ctaPrimary}</a>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <a href="#pricing">{LANDING_COPY.closing.ctaSecondary}</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
