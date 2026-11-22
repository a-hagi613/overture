import type { ReactNode } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "./backdrop.tsx";
import { LegalTopBar } from "./legal-top-bar.tsx";
import { NavGlyph } from "./nav-glyph.tsx";

export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className="legal-surface relative min-h-screen overflow-hidden bg-background text-foreground">
      <Backdrop />
      <div className="relative z-[1] flex min-h-screen flex-col">
        <LegalTopBar />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[680px] px-[clamp(18px,4vw,40px)] pt-[clamp(20px,4vw,48px)] pb-[56px] outline-none"
        >
          <Link
            className="-my-2 -ml-[10px] inline-flex min-h-11 items-center gap-[7px] rounded-md px-[10px] py-1 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            to="/"
          >
            <NavGlyph name="back" size={15} />
            {copy.legal.back}
          </Link>
          {children}
        </main>
        <footer className="mx-auto w-full max-w-[680px] border-t border-border px-[clamp(18px,4vw,40px)] pb-[40px] pt-[20px]">
          <p className="font-serif text-[12.5px] leading-[1.6] text-muted-foreground">
            {copy.legal.draftNotice}
          </p>
          <p className="mt-[6px] font-serif text-[12.5px] leading-[1.6] text-muted-foreground">
            {copy.legal.footerName}
            {copy.legal.footerSeparator}
            {copy.legal.footerContact}
            {copy.legal.footerSeparator}
            {copy.legal.footerAddress}
          </p>
          <nav
            aria-label={copy.legal.footerLinksLabel}
            className="mt-[6px] flex items-center gap-[6px] font-serif text-[12.5px] leading-[1.6] text-muted-foreground"
          >
            <Link
              className="-my-3 inline-flex min-h-11 items-center underline underline-offset-[3px] transition-colors hover:text-foreground"
              to="/terms"
            >
              {copy.legal.termsLink}
            </Link>
            <span aria-hidden="true">{copy.legal.footerSeparator.trim()}</span>
            <Link
              className="-my-3 inline-flex min-h-11 items-center underline underline-offset-[3px] transition-colors hover:text-foreground"
              to="/privacy"
            >
              {copy.legal.privacyLink}
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
