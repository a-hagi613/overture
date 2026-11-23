import { ArrowLeft } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Link } from "react-router";

import { HeaderControls } from "./header-controls.tsx";

export function PageHeader({
  backLink,
  headingRef,
  lead,
  titleNode,
}: {
  backLink?: { href: string; label: string };
  calendar?: boolean;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  lead: string;
  showRunningSwitch?: boolean;
  titleNode: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-6 md:gap-y-4">
      <div className="min-w-0">
        {backLink === undefined ? null : (
          <Link
            className="mb-2 inline-flex min-h-8 items-center gap-1.5 text-eyebrow font-semibold uppercase text-muted-foreground transition hover:text-foreground"
            to={backLink.href}
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            {backLink.label}
          </Link>
        )}
        <h1
          className="font-serif text-page-title font-normal text-foreground outline-none"
          ref={headingRef}
          tabIndex={headingRef === undefined ? undefined : -1}
        >
          {titleNode}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{lead}</p>
      </div>
      <HeaderControls />
    </header>
  );
}
