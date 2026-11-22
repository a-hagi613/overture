import type { ReactNode } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "./backdrop.tsx";
import { LegalTopBar } from "./legal-top-bar.tsx";
import { NavGlyph } from "./nav-glyph.tsx";

export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Backdrop />
      <div className="relative z-[1] flex min-h-screen flex-col">
        <LegalTopBar />
        <main
          id="main"
          tabIndex={-1}
          className="outline-none mx-auto w-full max-w-[636px] px-[18px] pt-[42px] md:pt-[70px]"
        >
          <Link
            className="-ml-2 inline-flex max-md:min-h-11 max-md:-my-[10px] items-center gap-[7px] rounded-md px-2 py-1 text-[13px] font-medium hover:bg-muted hover:text-foreground"
            to="/"
          >
            <NavGlyph name="back" size={15} />
            {copy.legal.back}
          </Link>
          {children}
        </main>
        <footer className="mx-auto mt-[98px] w-full max-w-[716px] px-[18px] pb-[34px]">
          <div className="border-t border-border pt-[16px]">
            <p className="font-serif text-[14px] leading-[1.6] text-muted-foreground">
              {copy.legal.footerName}
              {copy.legal.footerSeparator}
              {copy.legal.footerContact}
              {copy.legal.footerSeparator}
              {copy.legal.footerAddress}
            </p>
            <nav
              aria-label={copy.legal.footerLinksLabel}
              className="mt-1 flex items-center gap-[6px] font-serif text-[14px] leading-[1.6] text-muted-foreground"
            >
              <Link
                className="inline-flex items-center underline decoration-input underline-offset-[3px] transition-colors max-md:min-h-11 max-md:-my-[13px] hover:decoration-foreground hover:text-foreground"
                to="/terms"
              >
                {copy.legal.termsLink}
              </Link>
              <span aria-hidden="true">{copy.legal.footerSeparator.trim()}</span>
              <Link
                className="inline-flex items-center underline decoration-input underline-offset-[3px] transition-colors max-md:min-h-11 max-md:-my-[13px] hover:decoration-foreground hover:text-foreground"
                to="/privacy"
              >
                {copy.legal.privacyLink}
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
