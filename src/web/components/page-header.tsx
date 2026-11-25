import { ArrowLeft } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Link } from "react-router";

import { HeaderControls } from "./header-controls.tsx";
import { dsPageTitle } from "./ui/ds.ts";

export function PageHeader({
  actions,
  backLink,
  headingRef,
  lead,
  titleNode,
}: {
  actions?: ReactNode | undefined;
  backLink?: { href: string; label: string };
  calendar?: boolean;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  lead?: string | undefined;
  showRunningSwitch?: boolean;
  titleNode: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-x-6">
      <div className="min-w-0">
        {backLink === undefined ? null : (
          <Link
            className="mb-1.5 inline-flex min-h-8 items-center gap-1.5 text-eyebrow font-semibold uppercase text-muted-foreground transition hover:text-foreground"
            to={backLink.href}
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            {backLink.label}
          </Link>
        )}
        <h1
          className={`${dsPageTitle} outline-none`}
          ref={headingRef}
          tabIndex={headingRef === undefined ? undefined : -1}
        >
          {titleNode}
        </h1>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {lead === undefined || lead === "" ? null : (
          <p className="text-xs font-medium text-muted-foreground">{lead}</p>
        )}
        {actions === undefined ? null : actions}
        <HeaderControls />
      </div>
    </header>
  );
}
