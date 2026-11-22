import { marketingCopy } from "../../shared/marketing-copy.ts";

const linkClass =
  "inline-flex min-h-[44px] min-w-11 items-center justify-center text-[14px] text-foreground underline-offset-4 hover:text-muted-foreground hover:underline focus-visible:underline";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border text-muted-foreground">
      <div className="flex flex-col items-start gap-4 px-4 pb-8 pt-6 md:flex-row md:items-center md:justify-between md:px-10 md:py-8">
        <span className="font-serif text-[22px] text-foreground">{marketingCopy.brand}</span>
        <nav
          aria-label={marketingCopy.footer.navLabel}
          className="flex flex-wrap items-center gap-6"
        >
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
        <span className="font-mono text-[12px] md:text-right">{marketingCopy.footer.tagline}</span>
      </div>
    </footer>
  );
}
