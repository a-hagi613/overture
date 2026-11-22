import { copy } from "../../shared/copy.ts";
import { marketingCopy } from "../../shared/marketing-copy.ts";
import { BrandMark } from "./brand-mark.tsx";

const text = copy.notFound;

const linkClass =
  "inline-flex min-h-11 items-center text-[14px] font-medium text-muted-foreground hover:text-foreground";

/**
 * The footer drawn on the 404 board, with the full public link set and colophon.
 * @returns The public footer for the 404 page.
 */
export function NotFoundFooter() {
  return (
    <footer>
      <hr className="m-0 border-0 border-t border-border shadow-[0_1px_0_var(--color-hl)]" />
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-12 gap-y-5 px-[clamp(20px,4vw,48px)] pb-[30px] pt-6 min-[1700px]:max-w-[1440px]">
        <div className="flex items-center gap-2.5">
          <BrandMark size={26} />
          <span className="font-serif text-[25px] leading-none">{copy.app.name}</span>
        </div>
        <nav aria-label={text.footerNavLabel} className="flex flex-wrap gap-x-[30px] gap-y-1.5">
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
          <a className={linkClass} href="/privacy">
            {marketingCopy.footer.privacy}
          </a>
          <a className={linkClass} href="/terms">
            {marketingCopy.footer.terms}
          </a>
          <a className={linkClass} href="/signin">
            {text.nav.signIn}
          </a>
        </nav>
      </div>
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap justify-between gap-x-6 gap-y-2 px-[clamp(20px,4vw,48px)] pb-8 text-[12.5px] text-muted-foreground min-[1700px]:max-w-[1440px]">
        <span>{text.copyright}</span>
        <span className="font-serif text-[14px] italic">{text.colophon}</span>
      </div>
    </footer>
  );
}
