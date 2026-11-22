import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link, NavLink, useLocation } from "react-router";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";

const pages = [
  { key: "profileData", to: "/profile" },
  { key: "export", to: "/settings/export" },
  { key: "delete", to: "/settings/delete" },
  { key: "legal", to: "/terms" },
] as const;

const itemClass =
  "flex min-h-11 items-center rounded-md border px-3 text-sm font-medium leading-[21px] hover:bg-muted min-[768px]:min-h-9";

export function SettingsMenu({ showLabels }: { showLabels: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  if (!showLabels) {
    return (
      <NavLink
        aria-label={copy.settingsMenu.label}
        className={({ isActive }) =>
          `flex min-h-11 w-full items-center justify-center rounded-md border ${
            isActive ? "border-border bg-card shadow-sh" : "border-transparent hover:bg-muted"
          }`
        }
        to="/settings"
      >
        <NavGlyph name="sliders" />
      </NavLink>
    );
  }

  const items = () =>
    [...(listRef.current?.querySelectorAll("a") ?? [])].filter(
      (element): element is HTMLAnchorElement => element instanceof HTMLAnchorElement,
    );

  const onItemKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      toggleRef.current?.focus();

      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const list = items();
    const current = list.indexOf(event.currentTarget);
    const step = event.key === "ArrowDown" ? 1 : -1;

    event.preventDefault();
    list[(current + step + list.length) % list.length]?.focus();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-11 items-center gap-1 min-[768px]:min-h-9">
        <NavLink
          className={({ isActive }) =>
            `flex min-h-11 flex-1 items-center gap-3 rounded-md border px-3 text-sm font-medium leading-[21px] min-[768px]:min-h-9 ${
              isActive
                ? "border-border bg-card text-foreground shadow-sh"
                : "border-transparent text-foreground hover:bg-muted"
            }`
          }
          to="/settings"
        >
          <NavGlyph name="sliders" />
          <span className="whitespace-nowrap">{copy.settingsMenu.label}</span>
        </NavLink>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={copy.settingsMenu.pagesLabel}
          className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground min-[768px]:h-9 min-[768px]:w-9"
          onClick={() => {
            setOpen((value) => !value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && open) {
              event.preventDefault();
              items()[0]?.focus();
            }
          }}
          ref={toggleRef}
          type="button"
        >
          <span aria-hidden="true" className={open ? "rotate-180" : undefined}>
            <NavGlyph name="chevron" />
          </span>
        </button>
      </div>
      <div
        className={open ? "ml-5 flex flex-col gap-[3px] border-l border-border pl-2" : "hidden"}
        id={panelId}
        ref={listRef}
      >
        {pages.map((page) => {
          const current = pathname === page.to;

          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={`${itemClass} ${current ? "border-border bg-card shadow-sh" : "border-transparent"}`}
              key={page.key}
              onKeyDown={onItemKeyDown}
              to={page.to}
            >
              {copy.settingsMenu[page.key]}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
