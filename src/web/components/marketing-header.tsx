import { marketingCopy } from "../../shared/marketing-copy.ts";

const linkBase =
  "min-h-[44px] items-center whitespace-nowrap text-[15px] text-foreground underline-offset-4 hover:underline focus-visible:underline";

const linkClass = `inline-flex ${linkBase}`;
const desktopOnlyClass = `hidden md:inline-flex ${linkBase}`;

export function MarketingHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-[63px] max-w-[1200px] items-center justify-between gap-4 px-4 md:h-[75px] md:px-10">
        <a
          className="inline-flex max-md:min-h-11 max-md:-my-[9px] items-center font-serif text-[26px] leading-none tracking-tight hover:opacity-80 md:text-[30px]"
          href="/"
        >
          {marketingCopy.brand}
        </a>
        <nav
          aria-label={marketingCopy.nav.primaryLabel}
          className="flex items-center gap-1 md:gap-8"
        >
          <a className={desktopOnlyClass} href="/#how-it-works">
            {marketingCopy.nav.howItWorks}
          </a>
          <a className={desktopOnlyClass} href="/#where-it-applies">
            {marketingCopy.nav.whereItApplies}
          </a>
          <a className={desktopOnlyClass} href="/pricing">
            {marketingCopy.nav.pricing}
          </a>
          <a className={`${linkClass} font-semibold`} href="/signin">
            {marketingCopy.nav.signIn}
          </a>
        </nav>
      </div>
    </header>
  );
}
