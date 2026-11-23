import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsPageTitle } from "./ui/ds.ts";

const HEADING_PLAIN = "Something went ";
const HEADING_ITALIC = "wrong";
const RELOAD_LABEL = "Reload";

export function RouteErrorBoundary() {
  return (
    <div className="min-h-screen overflow-x-clip bg-background px-4 py-12 text-foreground md:px-6">
      <main
        className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center outline-none"
        id="main-content"
        tabIndex={-1}
      >
        <Card className="w-full p-8 text-center" variant="elevated">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-need-soft text-need">
            <AlertTriangle aria-hidden="true" size={24} />
          </div>
          <div role="alert">
            <h1 className={`${dsPageTitle} mt-4`}>
              {HEADING_PLAIN}
              <em className="italic text-signal">{HEADING_ITALIC}</em>
            </h1>
            <p className={`${dsBody} mx-auto mt-2 max-w-sm`}>{copy.calendar.errorBody}</p>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={() => {
                globalThis.location.reload();
              }}
              size="default"
              variant="primary"
            >
              <RefreshCw aria-hidden="true" size={15} />
              <span>{RELOAD_LABEL}</span>
            </Button>
            <Button asChild size="default" variant="outline">
              <a href="/home">
                <ArrowLeft aria-hidden="true" size={15} />
                <span>{copy.nav.profilePages.notFoundHome}</span>
              </a>
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
