import { Link, useLocation } from "react-router";

import type { ReactNode } from "react";

import { copy } from "../../shared/copy.ts";
import { initialsOf } from "../lib/identity.ts";
import { authClient } from "../lib/auth-client.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { useTheme } from "../lib/theme-context.ts";

export function PageHeader({ lead, titleNode }: { lead: string; titleNode: ReactNode }) {
  const { pathname } = useLocation();
  const { theme, toggleTheme, label } = useTheme();
  const { data: session } = authClient.useSession();
  const name = session === null ? null : session.user.name;

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div>
        <p className="font-serif text-[15px] italic text-muted-foreground">{lead}</p>
        <h1 className="mt-0.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">{titleNode}</h1>
      </div>
      <div className="flex min-w-0 flex-[1_1_420px] flex-wrap items-center justify-end gap-3">
        <label className="flex h-10 min-w-[200px] max-w-[380px] flex-[1_1_260px] items-center gap-2.5 rounded-md border border-input bg-card px-3 max-[767px]:max-w-full">
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            viewBox="0 0 24 24"
            width="16"
            className="text-muted-foreground"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            aria-label={copy.shell.searchLabel}
            className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] font-medium outline-0 placeholder:text-muted-foreground"
            placeholder={copy.shell.searchPlaceholder}
            type="search"
          />
          <kbd className="hidden rounded-[2px] border border-input bg-background px-[7px] py-[2px] text-[11px] font-medium leading-[1.2] text-muted-foreground min-[768px]:inline">
            {copy.shell.searchShortcut}
          </kbd>
        </label>
        <button
          aria-label={label}
          aria-pressed={theme === "dark"}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-input bg-card hover:bg-muted max-[767px]:h-11 max-[767px]:w-11"
          onClick={toggleTheme}
          type="button"
        >
          {theme === "dark" ? <NavGlyph name="sun" /> : <NavGlyph name="moon" />}
        </button>
        <button
          aria-label={copy.sample.bellAria}
          className="relative flex h-10 w-10 items-center justify-center rounded-md border border-input bg-card hover:bg-muted max-[767px]:h-11 max-[767px]:w-11"
          type="button"
        >
          <NavGlyph name="bell" />
          <span className="absolute -right-1.5 -top-1.5 flex h-[19px] min-w-[19px] items-center justify-center rounded-[10px] border-2 border-background bg-foreground text-[11px] font-bold text-background tabular-nums">
            {copy.sample.inboxUnread}
          </span>
        </button>
        <Link
          aria-label={copy.shell.settings}
          aria-current={pathname === "/settings" ? "page" : undefined}
          className="hidden h-10 w-10 items-center justify-center rounded-full border border-input bg-muted font-serif text-[17px] italic max-[767px]:flex max-[767px]:h-11 max-[767px]:w-11"
          to="/settings"
        >
          {name === null ? "" : initialsOf(name)}
        </Link>
        <div className="flex h-10 items-center gap-3 rounded-md border border-input bg-card pl-3.5 pr-1.5">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <span className="h-2 w-2 rounded-full bg-signal" />
            {copy.sample.autoApplyLabel}
          </span>
          <button
            className="inline-flex h-[30px] items-center justify-center gap-2 rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold hover:bg-muted"
            type="button"
          >
            <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 24 24" width="12">
              <rect height="14" rx="1" width="4" x="6" y="5" />
              <rect height="14" rx="1" width="4" x="14" y="5" />
            </svg>
            {copy.sample.pause}
          </button>
        </div>
      </div>
    </header>
  );
}
