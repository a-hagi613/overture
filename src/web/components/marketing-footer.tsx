import { marketingCopy } from "../../shared/marketing-copy.ts";
import { MarketingMark } from "./marketing-mark.tsx";

const footerLinks = [
  { href: "/pricing", label: marketingCopy.nav.pricing },
  { href: "/#faq", label: marketingCopy.nav.questions },
  { href: "/privacy", label: marketingCopy.footer.privacy },
  { href: "/terms", label: marketingCopy.footer.terms },
];

const linkClass =
  "inline-flex min-h-[44px] min-w-11 items-center justify-center text-[14px] text-foreground underline-offset-4 hover:text-muted-foreground hover:underline focus-visible:underline";

/**
 * The footer the public marketing pages share. The landing board draws the mark and the
 * questions link; the pricing board draws the plain brand, Terms, Privacy and Pricing row,
 * so the `landing` flag picks between the two without changing either board's composition.
 * @param props `landing` when the page is the landing board.
 * @returns The marketing footer element.
 */
export function MarketingFooter({ landing = false }: { landing?: boolean }) {
  if (!landing) {
    return (
      <footer className="border-t border-border text-muted-foreground">
        <div className="flex flex-col gap-4 px-4 pt-6 pb-8 md:flex-row md:items-center md:justify-between md:px-10 md:py-8">
          <span className="font-serif text-[22px] tracking-[0]! text-foreground">
            {marketingCopy.brand}
          </span>
          <nav aria-label={marketingCopy.footer.navLabel} className="flex items-center gap-6">
            <a className={linkClass} href="/terms">
              {marketingCopy.footer.terms}
            </a>
            <a className={linkClass} href="/privacy">
              {marketingCopy.footer.privacy}
            </a>
            <a className={linkClass} href="/pricing">
              {marketingCopy.footer.pricing}
            </a>
          </nav>
          <span className="font-mono text-[12px]">{marketingCopy.footer.tagline}</span>
        </div>
      </footer>
    );
  }

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
