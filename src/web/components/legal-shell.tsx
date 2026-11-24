import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "./backdrop.tsx";
import { LegalTopBar } from "./legal-top-bar.tsx";
import { Button } from "./ui/button.tsx";
import { Separator } from "./ui/separator.tsx";

export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      <Backdrop />
      <div className="relative z-10 flex min-h-screen flex-col">
        <LegalTopBar />
        <main
          className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-6 outline-none sm:px-6 md:pt-10"
          id="main-content"
          tabIndex={-1}
        >
          <Button asChild className="-ml-2 mb-5" size="sm" variant="ghost">
            <Link to="/">
              <ArrowLeft aria-hidden="true" size={14} />
              <span>{copy.legal.back}</span>
            </Link>
          </Button>
          {children}
        </main>
        <footer className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-6">
          <Separator />
          <div className="mt-5 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <p>{copy.legal.draftNotice}</p>
            <p>
              {`${copy.legal.footerName}${copy.legal.footerSeparator}${copy.legal.footerContact}`}
            </p>
            <nav aria-label={copy.legal.footerLinksLabel} className="flex items-center gap-3 pt-1">
              <Link
                className="font-medium text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center"
                to="/terms"
              >
                {copy.legal.termsLink}
              </Link>
              <span aria-hidden="true">{copy.legal.footerSeparator.trim()}</span>
              <Link
                className="font-medium text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center"
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
