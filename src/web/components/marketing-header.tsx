import { marketingCopy } from "../../shared/marketing-copy.ts";
import { MarketingMark } from "./marketing-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

const navLinks = [
  { href: "/#how", label: marketingCopy.nav.howItWorks },
  { href: "/#boards", label: marketingCopy.nav.whereItApplies },
  { href: "/pricing", label: marketingCopy.nav.pricing },
  { href: "/#faq", label: marketingCopy.nav.questions },
];

const linkBase =
  "min-h-[44px] items-center whitespace-nowrap text-[15px] text-foreground underline-offset-4 hover:underline focus-visible:underline";

const linkClass = `inline-flex ${linkBase}`;
const desktopOnlyClass = `hidden md:inline-flex ${linkBase}`;

/**
 * The header the public marketing pages share. The landing board draws the mark, the
 * questions link and the theme toggle; the pricing board draws the plain 76px bar, so the
 * `landing` flag picks between the two without changing either board's composition.
 * @param props `landing` when the page is the landing board.
 * @returns The marketing header element.
 */
export function MarketingHeader({ landing = false }: { landing?: boolean }) {
  if (!landing) {
    return (
      <header className="h-16 border-b border-border md:h-[76px]">
        <div className="flex h-full items-center justify-between gap-4 px-4 md:px-10">
          <a
            className="inline-flex max-md:-my-[9px] max-md:min-h-11 items-center font-serif text-[26px] leading-none tracking-[0]! hover:opacity-80 md:text-[30px] md:tracking-[-0.01em]!"
            href="/"
          >
            {marketingCopy.brand}
          </a>
          <nav
            aria-label={marketingCopy.nav.primaryLabel}
            className="flex items-center gap-1 md:gap-8"
          >
            <a className={desktopOnlyClass} href="/#how">
              {marketingCopy.nav.howItWorks}
            </a>
            <a className={desktopOnlyClass} href="/#boards">
              {marketingCopy.nav.whereItApplies}
            </a>
            <a className={linkClass} href="/pricing">
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
