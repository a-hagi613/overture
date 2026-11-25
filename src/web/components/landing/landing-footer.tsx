import { BrandMark } from "../brand-mark.tsx";
import { dsContainer, dsDisplayCardTitle, dsNavLink } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";

const FOOTER_LINKS = [
  { href: "#how-it-works", label: LANDING_COPY.nav.howItWorks },
  { href: "#live-jobs", label: LANDING_COPY.nav.liveJobs },
  { href: "#pricing", label: LANDING_COPY.nav.pricing },
  { href: "#faq", label: LANDING_COPY.nav.faq },
  { href: "/privacy", label: LANDING_COPY.nav.privacy },
  { href: "/terms", label: LANDING_COPY.nav.terms },
] as const;

export function LandingFooter() {
  return (
    <footer className="relative z-10">
      <div
        className={`${dsContainer} flex flex-col gap-4 py-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-8 sm:gap-y-3 sm:py-6`}
      >
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <div className="flex items-center gap-2.5">
            <BrandMark size={26} />
            <span className={dsDisplayCardTitle}>{LANDING_COPY.brand}</span>
          </div>
          <span className="text-xs text-muted-foreground">{LANDING_COPY.footer.copyright}</span>
        </div>
        <nav
          aria-label="Footer"
          className="grid w-full grid-cols-3 gap-x-4 gap-y-1.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-7"
        >
          {FOOTER_LINKS.map((link) => (
            <a className={dsNavLink} href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
