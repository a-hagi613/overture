import { LandingClosingSection } from "../components/landing/landing-closing-section.tsx";
import { LandingDashboardPreview } from "../components/landing/landing-dashboard-preview.tsx";
import { LandingFaqSection } from "../components/landing/landing-faq-section.tsx";
import { LandingFooter } from "../components/landing/landing-footer.tsx";
import { LandingGrain } from "../components/landing/landing-grain.tsx";
import { LandingHeader } from "../components/landing/landing-header.tsx";
import { LandingHeroCopy } from "../components/landing/landing-hero-copy.tsx";
import { LandingHeroStack } from "../components/landing/landing-hero-stack.tsx";
import { LandingHowItWorks } from "../components/landing/landing-how-it-works.tsx";
import { LandingPricingSection } from "../components/landing/landing-pricing-section.tsx";
import { dsContainer } from "../components/ui/ds.ts";

/**
 * The public landing at `/`, prerendered to static HTML by `scripts/prerender.tsx`.
 *
 * @returns The landing page element.
 */
export function LandingPage() {
  return (
    <div
      className="relative overflow-x-clip bg-background font-sans text-foreground antialiased"
      id="top"
    >
      <LandingHeader />

      <main id="main-content" tabIndex={-1}>
        <section className="relative">
          <LandingGrain variant="hero" />
          <div
            className={`${dsContainer} relative z-10 pb-20 pt-10 sm:pb-28 sm:pt-16 lg:pb-28 lg:pt-16`}
          >
            <div className="grid grid-cols-1 items-center gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)] xl:gap-x-14">
              <LandingHeroCopy />
              <LandingHeroStack />
            </div>
          </div>
        </section>

        <LandingHowItWorks />
        <LandingDashboardPreview />
        <LandingPricingSection />
        <LandingFaqSection />
        <LandingClosingSection />
      </main>

      <LandingFooter />
    </div>
  );
}
