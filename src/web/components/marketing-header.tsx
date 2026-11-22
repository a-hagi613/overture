import { marketingCopy } from "../../shared/marketing-copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { MarketingMark } from "./marketing-mark.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

const navLinks = [
  { href: "/#how", label: marketingCopy.nav.howItWorks },
  { href: "/#boards", label: marketingCopy.nav.whereItApplies },
  { href: "/pricing", label: marketingCopy.nav.pricing },
  { href: "/#faq", label: marketingCopy.nav.questions },
];

export function MarketingHeader() {
  return (
    <header className="landing-header">
      <div className="wrap landing-hd">
        <a aria-label="Overture, home" className="landing-brand" href="/">
          <MarketingMark />
          <span className="serif">{marketingCopy.brand}</span>
        </a>

        <nav aria-label={marketingCopy.nav.primaryLabel} className="landing-nav">
          {navLinks.map((link) => (
            <a className="nl" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="landing-phone">
          <a className="nl" href="/pricing">
            {marketingCopy.nav.pricing}
          </a>
          <a className="nl" href="/signin">
            {marketingCopy.nav.signIn}
          </a>
          <ThemeToggle className="tgl" />
        </div>

        <div className="landing-actions">
          <a className="btn2 si" href="/signin">
            {marketingCopy.nav.signIn}
          </a>
          <a className="btn" href="/signin">
            {marketingCopy.cta.startTrial}
            <NavGlyph name="forward" size={15} />
          </a>
          <span aria-hidden="true" className="landing-hd-div" />
          <ThemeToggle className="tgl" />
        </div>
      </div>
    </header>
  );
}
