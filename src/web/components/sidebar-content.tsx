import { PanelLeftClose } from "lucide-react";
import { Link } from "react-router";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { SideNav } from "./side-nav.tsx";
import { SidebarNavUser } from "./sidebar-nav-user.tsx";
import { SidebarSearchButton } from "./sidebar-search-button.tsx";
import { Button } from "./ui/button.tsx";
import { Separator } from "./ui/separator.tsx";
import { TooltipHint } from "./ui/tooltip-hint.tsx";
import { UsageCard } from "./usage.tsx";

export function SidebarContent({
  counts,
  onCollapse,
  onNavigate,
  onOpenSearch,
  unreadNotifications = 0,
}: {
  counts: NavCounts;
  onCollapse: () => void;
  onNavigate?: (() => void) | undefined;
  onOpenSearch: () => void;
  unreadNotifications?: number;
}) {
  return (
    <div className="flex h-full flex-col gap-1.5 bg-sidebar px-3.5 py-3">
      <div className="flex items-center justify-between px-1.5">
        <Link
          aria-label={copy.brand.homeAria}
          className="flex items-center gap-2.5 transition hover:opacity-80"
          onClick={onNavigate}
          to="/home"
        >
          <BrandMark size={30} />
          <span className="font-serif text-card-title leading-none text-foreground">
            {copy.app.name}
          </span>
        </Link>
        <TooltipHint label={copy.shell.collapseSidebar}>
          <Button
            ariaLabel={copy.shell.collapseSidebar}
            className="h-9 w-9"
            onClick={onCollapse}
            size="icon"
            variant="ghost"
          >
            <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
          </Button>
        </TooltipHint>
      </div>
      <Separator />
      <SidebarSearchButton onOpen={onOpenSearch} />
      <Separator />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-0.5">
        <SideNav
          counts={counts}
          onNavigate={onNavigate}
          showLabels
          unreadNotifications={unreadNotifications}
        />
      </div>
      <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-2">
        <UsageCard />
        <SidebarNavUser onNavigate={onNavigate} />
      </div>
    </div>
  );
}
