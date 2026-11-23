import { ChevronDown, User } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";

import { copy } from "../../shared/copy.ts";
import { PROFILE_SUBMENU } from "../lib/nav-api.ts";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";

export function SidebarProfileMenu({ wide }: { wide: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const isProfileActive = pathname.startsWith("/profile");

  if (!wide) {
    return (
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false);
          }
        }}
        onFocus={() => {
          setOpen(true);
        }}
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
          to="/profile/resume"
        >
          <User aria-hidden="true" size={20} />
        </Link>
        {open ? (
          <div
            aria-label={copy.nav.profileMenu.label}
            className="absolute left-full top-0 z-50 pl-2"
            role="menu"
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
                      onClick={() => {
                        setOpen(false);
                      }}
                      role="menuitem"
                      to={item.to}
                    >
                      {item.label}
                    </Link>
                  );
                })}
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
      onFocus={() => {
        setOpen(true);
      }}
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
          role="menu"
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
                role="menuitem"
                to={item.to}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
