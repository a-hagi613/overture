import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { useTheme } from "../lib/theme-context.ts";

const text = copy.notFound;

const linkClass =
  "inline-flex min-h-11 items-center text-[14px] font-medium text-muted-foreground hover:text-foreground";

/**
 * The 404 board uses the full public nav (Questions, a theme toggle and Start free).
 * The shared MarketingHeader is mobile-minimal, so this page keeps its own chrome.
 * @returns The public header for the 404 page.
 */
export function NotFoundHeader() {
  const { theme, toggleTheme, label } = useTheme();

  return (
    <header className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-[clamp(20px,4vw,48px)] pb-[18px] pt-[26px] min-[1700px]:max-w-[1440px]">
      <Link aria-label={copy.brand.homeAria} className="inline-flex items-center gap-[11px]" to="/">
        <BrandMark size={32} />
        <span className="font-serif text-[29px] leading-none tracking-[-0.01em]">
          {copy.app.name}
        </span>
      </Link>
      <nav
        aria-label={text.navLabel}
        className="order-3 mt-1 flex w-full flex-wrap gap-x-3.5 gap-y-1 min-[701px]:order-none min-[701px]:mt-0 min-[701px]:w-auto min-[701px]:gap-x-[30px]"
      >
        <a className={linkClass} href="/#how-it-works">
          {text.nav.howItWorks}
        </a>
        <a className={linkClass} href="/#where-it-applies">
          {text.nav.whereItApplies}
        </a>
        <a className={linkClass} href="/pricing">
          {text.nav.pricing}
        </a>
        <a className={linkClass} href="/#faq">
          {text.nav.questions}
        </a>
      </nav>
      <div className="flex items-center gap-3.5">
        <button
          aria-label={label}
          aria-pressed={theme === "dark"}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-input bg-card text-foreground hover:bg-muted"
          onClick={toggleTheme}
          type="button"
        >
          <NavGlyph name={theme === "dark" ? "sun" : "moon"} size={18} />
        </button>
        <a className={`${linkClass} hidden min-[481px]:inline-flex`} href="/signin">
          {text.nav.signIn}
        </a>
        <a
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-foreground bg-foreground px-5 text-[14px] font-semibold text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover"
          href="/signin"
        >
          {text.nav.start}
        </a>
      </div>
    </header>
  );
}
