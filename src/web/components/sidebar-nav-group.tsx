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
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { TooltipHint } from "./ui/tooltip-hint.tsx";

export interface SidebarGroupItem {
  badgeClass?: string | undefined;
  badgeCount?: number | undefined;
  badgeKey?: string | undefined;
  icon: LucideIcon;
  isActive: boolean;
  key: string;
  label: string;
  srLabel?: string | undefined;
  to: string;
}

const ROW_CLASS =
  "relative flex min-h-8 items-center gap-3 rounded-md border px-2.5 text-sm font-medium transition";

const ROW_IDLE = "border-transparent text-foreground hover:bg-muted";
const ROW_ACTIVE = "border-border bg-card text-foreground";
const RAIL_IDLE = "border-transparent text-foreground hover:bg-muted";
const RAIL_ACTIVE = "border-border bg-card text-foreground";

/**
 * Reusable collapsible sidebar section (expanded sidebar/drawer) and popover menu (collapsed rail).
 * @param props Section header, persistence key, child navigation items, and collapsed badge summary.
 * @param props.badgeClass Tailwind badge class applied to the collapsed summary pill.
 * @param props.badgeCount Optional aggregate count shown on the collapsed rail icon.
 * @param props.icon Lucide icon displayed on the section header and collapsed rail button.
 * @param props.items Ordered navigation links inside this section.
 * @param props.label Section heading label.
 * @param props.menuLabel Accessible dropdown menu label when collapsed.
 * @param props.onNavigate Optional callback invoked when any child link is clicked.
 * @param props.storageKey LocalStorage key persisting expanded/collapsed state.
 * @param props.wide Whether the expanded sidebar label column is visible.
 * @returns Collapsible group or compact rail dropdown menu.
 */
export function SidebarNavGroup({
  badgeClass = "bg-muted text-foreground",
  badgeCount = 0,
  icon: GroupIcon,
  items,
  label,
  menuLabel,
  onNavigate,
  storageKey,
  wide,
}: {
  badgeClass?: string | undefined;
  badgeCount?: number | undefined;
  icon: LucideIcon;
  items: readonly SidebarGroupItem[];
  label: string;
  menuLabel: string;
  onNavigate?: (() => void) | undefined;
  storageKey: string;
  wide: boolean;
}) {
  const activeGroup = items.some((item) => item.isActive);

  const [open, setOpen] = useState(() => {
    const stored = globalThis.localStorage.getItem(storageKey);

    return stored !== "0";
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    globalThis.localStorage.setItem(storageKey, nextOpen ? "1" : "0");
  };

  if (!wide) {
    return (
      <DropdownRoot>
        <TooltipHint label={label}>
          <DropdownTrigger asChild>
            <button
              aria-label={badgeCount > 0 ? `${label}, ${String(badgeCount)}` : label}
              className={`relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                activeGroup ? RAIL_ACTIVE : RAIL_IDLE
              }`}
              type="button"
            >
              {activeGroup ? (
                <span
                  aria-hidden="true"
                  className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                />
              ) : null}
              <GroupIcon aria-hidden="true" size={20} />
              {badgeCount > 0 ? (
                <span
                  aria-hidden="true"
                  className={`absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs font-semibold leading-none tabular-nums ${badgeClass}`}
                >
                  {badgeCount}
                </span>
              ) : null}
            </button>
          </DropdownTrigger>
        </TooltipHint>
        <DropdownPortal>
          <DropdownContent
            align="start"
            aria-label={menuLabel}
            className="z-50 w-56 rounded-xl border border-input bg-card p-1.5 text-foreground shadow-lift outline-none"
            side="right"
            sideOffset={10}
          >
            <DropdownLabel className="px-2.5 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </DropdownLabel>
            {items.map((item) => {
              const Icon = item.icon;
              const count = item.badgeCount ?? 0;

              return (
                <DropdownItem asChild key={item.key}>
                  <Link
                    aria-current={item.isActive ? "page" : undefined}
                    className={`flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium outline-none transition focus:bg-muted ${
                      item.isActive ? "bg-muted font-semibold text-signal-text" : "text-foreground"
                    }`}
                    onClick={onNavigate}
                    to={item.to}
                  >
                    {item.srLabel === undefined ? null : (
                      <span className="sr-only">{item.srLabel}</span>
                    )}
                    <Icon aria-hidden="true" className="shrink-0 text-muted-foreground" size={16} />
                    <span aria-hidden={item.srLabel !== undefined}>{item.label}</span>
                    {count > 0 ? (
                      <span
                        aria-hidden="true"
                        className={`ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${item.badgeClass ?? "bg-muted text-foreground"}`}
                      >
                        {count}
                      </span>
                    ) : null}
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
          className="flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          type="button"
        >
          <span className="flex items-center gap-2">
            <GroupIcon aria-hidden="true" className="shrink-0" size={14} />
            <span>{label}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            size={14}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const count = item.badgeCount ?? 0;

          return (
            <Link
              aria-current={item.isActive ? "page" : undefined}
              className={`${ROW_CLASS} ${item.isActive ? ROW_ACTIVE : ROW_IDLE}`}
              key={item.key}
              onClick={onNavigate}
              to={item.to}
            >
              {item.srLabel === undefined ? null : <span className="sr-only">{item.srLabel}</span>}
              {item.isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute -left-px bottom-1.5 top-1.5 w-0.5 rounded-full bg-signal"
                />
              ) : null}
              <Icon aria-hidden="true" className="shrink-0" size={18} />
              <span aria-hidden={item.srLabel !== undefined} className="whitespace-nowrap">
                {item.label}
              </span>
              {count > 0 ? (
                <span
                  aria-hidden="true"
                  className={`ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${item.badgeClass ?? "bg-muted text-foreground"}`}
                  data-nav-badge={item.badgeKey}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}
