import type { ReactNode } from "react";
import { Link } from "react-router";

import { HeaderControls } from "./header-controls.tsx";

export function PageHeader({
  backLink,
  calendar = false,
  home = false,
  lead,
  showRunningSwitch = true,
  titleNode,
}: {
  backLink?: { href: string; label: string };
  calendar?: boolean;
  home?: boolean;
  lead: string;
  showRunningSwitch?: boolean;
  titleNode: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div>
        {backLink === undefined ? (
          <p className="font-serif text-[15px] italic text-muted-foreground">{lead}</p>
        ) : (
          <Link
            className="inline-flex max-md:min-h-11 max-md:-my-[15px] items-center text-[11px] font-semibold uppercase tracking-[1.65px] leading-[normal] text-foreground hover:underline"
            to={backLink.href}
          >
            {"← "}
            {backLink.label}
          </Link>
        )}
        <h1
          className={`${backLink === undefined ? "mt-0.5" : "mt-2"} font-serif text-[32px] leading-[1.05] md:text-[42px]`}
        >
          {titleNode}
        </h1>
        {backLink === undefined ? null : (
          <p className="mt-1 font-serif text-[15px] italic leading-[1.5] text-muted-foreground">
            {lead}
          </p>
        )}
      </div>
      <HeaderControls calendar={calendar} home={home} running={showRunningSwitch} />
    </header>
  );
}
