import { ChevronDown, User } from "lucide-react";
import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useLocation } from "react-router";

import { copy } from "../../shared/copy.ts";
import { PROFILE_SUBMENU } from "../lib/nav-api.ts";
import { AdminPortalMenuItem } from "./admin-portal-menu-item.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";

export function SidebarProfileMenu({ wide }: { wide: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const suppressFocusOpen = useRef(false);

  const isProfileActive = pathname.startsWith("/profile");

  const closeMenu = () => {
    setOpen(false);
  };

  const getMenuItems = () =>
    [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter(
      (item) => item.offsetParent !== null,
    );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        suppressFocusOpen.current = true;
        setOpen(false);
        triggerRef.current?.focus();
      }

      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();

    if (!open) {
      setOpen(true);
      globalThis.requestAnimationFrame(() => {
        const items = getMenuItems();

        (event.key === "ArrowDown" ? items.at(0) : items.at(-1))?.focus();
      });

      return;
    }

    const items = getMenuItems();

    if (items.length === 0) {
      return;
    }

    const active = document.activeElement;
    const currentIndex = active instanceof HTMLElement ? items.indexOf(active) : -1;

    if (currentIndex === -1) {
      (event.key === "ArrowDown" ? items.at(0) : items.at(-1))?.focus();

      return;
    }

    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + delta + items.length) % items.length;

    items[nextIndex]?.focus();
  };

  const handleFocus = () => {
    if (suppressFocusOpen.current) {
      suppressFocusOpen.current = false;

      return;
    }

    setOpen(true);
  };

  if (!wide) {
    return (
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false);
          }
        }}
        onFocus={handleFocus}
        onMouseEnter={() => {
          setOpen(true);
        }}
        onMouseLeave={() => {
          setOpen(false);
        }}
      >
        <Link
          aria-current={isProfileActive ? "page" : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={copy.nav.profile}
          className={`rl ${isProfileActive ? "on" : ""}`}
          onKeyDown={handleKeyDown}
          ref={triggerRef}
          to="/profile/resume"
        >
          <User aria-hidden="true" size={20} />
        </Link>
        {open ? (
          <div
            aria-label={copy.nav.profileMenu.label}
            className="absolute left-full top-0 z-50 pl-2"
            onKeyDown={handleKeyDown}
            ref={menuRef}
            role="menu"
            tabIndex={-1}
          >
            <Card className="w-56 p-1.5" variant="elevated">
              <p className={`${dsEyebrow} px-2.5 pb-1.5 pt-1`}>{copy.nav.profile}</p>
              <div className="flex flex-col gap-0.5">
                {PROFILE_SUBMENU.map((item) => {
                  const active = pathname === item.to;

                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-9 items-center rounded-md px-2.5 text-sm font-medium transition ${
                        active
                          ? "bg-muted font-semibold text-signal-text"
                          : "text-foreground hover:bg-muted"
                      }`}
                      key={item.key}
                      onClick={closeMenu}
                      role="menuitem"
                      to={item.to}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                <AdminPortalMenuItem
                  className="flex min-h-9 items-center rounded-md px-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
                  onSelect={closeMenu}
                  role="menuitem"
                />
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
      onFocus={handleFocus}
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
    >
      <Link
        aria-current={isProfileActive ? "page" : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={copy.nav.profile}
        className={`relative flex min-h-11 items-center gap-3.5 rounded-md border px-3 text-base font-medium transition ${
          isProfileActive
            ? "border-border bg-card text-foreground shadow-sh hover:border-input hover:bg-muted"
            : "border-transparent text-foreground hover:bg-muted"
        }`}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        to="/profile/resume"
      >
        {isProfileActive ? (
          <span
            aria-hidden="true"
            className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
          />
        ) : null}
        <User aria-hidden="true" className="shrink-0" size={20} />
        <span className="flex-1 whitespace-nowrap">{copy.nav.profile}</span>
        <ChevronDown
          aria-hidden="true"
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180 text-foreground" : ""
          }`}
          size={18}
        />
      </Link>

      {open ? (
        <div
          aria-label={copy.nav.profileMenu.label}
          className="ml-5 mt-1 flex flex-col gap-0.5 border-l border-border pl-2.5"
          onKeyDown={handleKeyDown}
          ref={menuRef}
          role="menu"
          tabIndex={-1}
        >
          {PROFILE_SUBMENU.map((item) => {
            const active = pathname === item.to;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`flex min-h-8 items-center rounded-md border px-2.5 text-sm font-medium transition ${
                  active
                    ? "border-border bg-card font-semibold text-signal-text shadow-sh"
                    : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                key={item.key}
                onClick={closeMenu}
                role="menuitem"
                to={item.to}
              >
                {item.label}
              </Link>
            );
          })}
          <AdminPortalMenuItem
            className="flex min-h-8 items-center rounded-md border border-transparent px-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onSelect={closeMenu}
            role="menuitem"
          />
        </div>
      ) : null}
    </div>
  );
}
