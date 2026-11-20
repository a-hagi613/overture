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
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
        <label className="hidden h-10 min-w-[200px] max-w-[380px] flex-[1_1_260px] items-center gap-2.5 rounded-md border border-input bg-card px-3 min-[768px]:flex">
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
          <kbd className="hidden rounded border border-input bg-background px-1.5 py-0.5 text-[11.5px] font-medium text-muted-foreground min-[768px]:inline">
            {copy.shell.searchShortcut}
          </kbd>
        </label>
        <button
          aria-label={label}
          aria-pressed={theme === "dark"}
          className="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-card hover:bg-muted max-[767px]:h-11 max-[767px]:w-11"
          onClick={toggleTheme}
          type="button"
        >
          {theme === "dark" ? <NavGlyph name="sun" /> : <NavGlyph name="moon" />}
        </button>
        <Link
          aria-label={copy.shell.settings}
          aria-current={pathname === "/settings" ? "page" : undefined}
          className="hidden h-10 w-10 items-center justify-center rounded-full border-2 border-foreground bg-muted font-serif text-[17px] italic max-[767px]:flex"
          to="/settings"
        >
          {name === null ? "" : initialsOf(name)}
        </Link>
      </div>
    </header>
  );
}
