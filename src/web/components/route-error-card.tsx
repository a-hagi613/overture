import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsPageTitle } from "./ui/ds.ts";

const HEADING_PLAIN = "Something went ";
const HEADING_ITALIC = "wrong";

export function RouteErrorCard({
  insideShell = false,
  onRetry,
}: {
  insideShell?: boolean;
  onRetry: () => void;
}) {
  const message = (
    <>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-need-soft text-need">
        <AlertTriangle aria-hidden="true" size={24} />
      </div>
      <h1 className={`${dsPageTitle} mt-4`}>{`${HEADING_PLAIN}${HEADING_ITALIC}`}</h1>
      <p className={`${dsBody} mx-auto mt-2 max-w-sm`}>{copy.calendar.errorBody}</p>
    </>
  );

  const actions = (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
      <Button onClick={onRetry} size="default" variant="primary">
        <RefreshCw aria-hidden="true" size={15} />
        <span>{copy.calendar.retry}</span>
      </Button>
      <Button asChild size="default" variant="outline">
        <a href="/home">
          <ArrowLeft aria-hidden="true" size={15} />
          <span>{copy.nav.profilePages.notFoundHome}</span>
        </a>
      </Button>
    </div>
  );

  const body = (
    <Card className="w-full p-8 text-center">
      {message}
      {actions}
    </Card>
  );

  if (insideShell) {
    return (
      <div
        className="mx-auto flex w-full max-w-xl flex-1 items-center justify-center py-8"
        role="alert"
      >
        {body}
      </div>
    );
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center overflow-x-clip bg-background px-4 py-12 text-foreground outline-none md:px-6"
      id="main-content"
      tabIndex={-1}
    >
      <div className="w-full max-w-xl" role="alert">
        {body}
      </div>
    </main>
  );
}
