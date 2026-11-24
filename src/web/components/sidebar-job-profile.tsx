import {
  Content as CollapsibleContent,
  Root as CollapsibleRoot,
  Trigger as CollapsibleTrigger,
} from "@radix-ui/react-collapsible";
import {
  Content as DropdownContent,
  Item as DropdownItem,
  Label as DropdownLabel,
  Portal as DropdownPortal,
  Root as DropdownRoot,
  Trigger as DropdownTrigger,
} from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ClipboardList, FileText, FileUser, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";

import { copy } from "../../shared/copy.ts";
import { isJobProfilePath, JOB_PROFILE_SUBMENU } from "../lib/nav-api.ts";
import { TooltipHint } from "./ui/tooltip-hint.tsx";

const STORAGE_KEY = "overture.jobProfileOpen";

const ROW_CLASS =
  "relative flex min-h-9 items-center gap-3 rounded-md border px-2.5 text-sm font-medium transition";

const ROW_IDLE = "border-transparent text-foreground hover:bg-muted";
const ROW_ACTIVE = "border-border bg-card text-foreground shadow-sh";

const SUBMENU_ICONS = {
  details: ClipboardList,
  preferences: SlidersHorizontal,
  resume: FileText,
} as const;

export function SidebarJobProfile({
  onNavigate,
  wide,
}: {
  onNavigate?: (() => void) | undefined;
  wide: boolean;
}) {
  const { pathname } = useLocation();
  const activeGroup = isJobProfilePath(pathname);

  const [open, setOpen] = useState(() => {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);

    return stored !== "0";
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    globalThis.localStorage.setItem(STORAGE_KEY, nextOpen ? "1" : "0");
  };

  if (!wide) {
    return (
      <DropdownRoot>
        <TooltipHint label={copy.nav.jobProfile}>
          <DropdownTrigger asChild>
            <button
              aria-label={copy.nav.jobProfile}
              className={`relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border transition ${
                activeGroup ? ROW_ACTIVE : ROW_IDLE
              }`}
              type="button"
            >
              {activeGroup ? (
                <span
                  aria-hidden="true"
                  className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                />
              ) : null}
              <FileUser aria-hidden="true" size={20} />
            </button>
          </DropdownTrigger>
        </TooltipHint>
        <DropdownPortal>
          <DropdownContent
            align="start"
            aria-label={copy.nav.jobProfileMenuLabel}
            className="z-50 w-56 rounded-xl border border-input bg-card p-1.5 text-foreground shadow-lift outline-none"
            side="right"
            sideOffset={10}
          >
            <DropdownLabel className="px-2.5 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {copy.nav.jobProfile}
            </DropdownLabel>
            {JOB_PROFILE_SUBMENU.map((item) => {
              const Icon = SUBMENU_ICONS[item.key];
              const itemActive = pathname === item.to;

              return (
                <DropdownItem asChild key={item.key}>
                  <Link
                    aria-current={itemActive ? "page" : undefined}
                    className={`flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium outline-none transition focus:bg-muted ${
                      itemActive ? "bg-muted font-semibold text-signal-text" : "text-foreground"
                    }`}
                    onClick={onNavigate}
                    to={item.to}
                  >
                    <Icon aria-hidden="true" className="shrink-0 text-muted-foreground" size={16} />
                    <span>{item.label}</span>
                  </Link>
                </DropdownItem>
              );
            })}
          </DropdownContent>
        </DropdownPortal>
      </DropdownRoot>
    );
  }

  return (
    <CollapsibleRoot className="flex flex-col gap-0.5" onOpenChange={handleOpenChange} open={open}>
      <CollapsibleTrigger asChild>
        <button
          className="flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          type="button"
        >
          <span>{copy.nav.jobProfile}</span>
          <ChevronDown
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            size={14}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-0.5">
        {JOB_PROFILE_SUBMENU.map((item) => {
          const Icon = SUBMENU_ICONS[item.key];

          return (
            <NavLink key={item.key} onClick={onNavigate} to={item.to}>
              {({ isActive }) => (
                <span className={`${ROW_CLASS} ${isActive ? ROW_ACTIVE : ROW_IDLE}`}>
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                    />
                  ) : null}
                  <Icon aria-hidden="true" className="shrink-0" size={18} />
                  <span className="whitespace-nowrap">{item.label}</span>
                </span>
              )}
            </NavLink>
          );
        })}
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}
