import { BrandMark } from "../brand-mark.tsx";
import { dsCardTitle, dsContainer, dsNavLink } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";

const FOOTER_LINKS = [
  { href: "#how-it-works", label: LANDING_COPY.nav.howItWorks },
  { href: "#where-it-applies", label: LANDING_COPY.nav.jobBoards },
  { href: "#pricing", label: LANDING_COPY.nav.pricing },
  { href: "#faq", label: LANDING_COPY.nav.faq },
  { href: "/privacy", label: LANDING_COPY.nav.privacy },
  { href: "/terms", label: LANDING_COPY.nav.terms },
] as const;

export function LandingFooter() {
  return (
    <footer className="relative z-10">
      <div
        className={`${dsContainer} flex flex-wrap items-center justify-between gap-x-12 gap-y-5 pb-6 pt-5`}
      >
        <div className="flex items-center gap-2.5">
          <BrandMark size={26} />
          <span className={dsCardTitle}>{LANDING_COPY.brand}</span>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-x-6 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-7"
        >
          {FOOTER_LINKS.map((link) => (
            <a className={dsNavLink} href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
      <div className={`${dsContainer} pb-8 text-xs text-muted-foreground`}>
        <span>{LANDING_COPY.footer.copyright}</span>
      </div>
    </footer>
  );
}
