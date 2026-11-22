import { marketingCopy } from "../../shared/marketing-copy.ts";
import { MarketingMark } from "./marketing-mark.tsx";

const footerLinks = [
  { href: "/pricing", label: marketingCopy.nav.pricing },
  { href: "/#faq", label: marketingCopy.nav.questions },
  { href: "/privacy", label: marketingCopy.footer.privacy },
  { href: "/terms", label: marketingCopy.footer.terms },
];

export function MarketingFooter() {
  return (
    <footer className="landing-footer">
      <div className="wrap landing-footer-row">
        <div className="landing-brand">
          <MarketingMark size={26} />
          <span className="serif">{marketingCopy.brand}</span>
        </div>
        <nav aria-label={marketingCopy.footer.navLabel} className="landing-footer-nav">
          {footerLinks.map((link) => (
            <a className="nl" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="wrap landing-copyright">{marketingCopy.footer.copyright}</div>
    </footer>
  );
}
