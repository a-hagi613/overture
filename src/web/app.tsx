import { PanelLeftClose } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";

import { copy } from "../shared/copy.ts";
import { Backdrop } from "./components/backdrop.tsx";
import { BoardRail } from "./components/board-rail.tsx";
import { BrandMark } from "./components/brand-mark.tsx";
import { RouteErrorBoundary } from "./components/route-error-boundary.tsx";
import { RouteFallback } from "./components/route-fallback.tsx";
import { SideNav } from "./components/side-nav.tsx";
import { SidebarSearchButton } from "./components/sidebar-search-button.tsx";
import { SidebarThemeToggle } from "./components/sidebar-theme-toggle.tsx";
import { TabBar } from "./components/tab-bar.tsx";
import { Button } from "./components/ui/button.tsx";
import { Separator } from "./components/ui/separator.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { UsageCard } from "./components/usage.tsx";
import { WorkspaceSearchDialog } from "./components/workspace-search-dialog.tsx";
import { authClient } from "./lib/auth-client.ts";
import { useLiveUpdates } from "./lib/live-events.ts";
import { useMediaQuery } from "./lib/media-query.ts";
import { useNavCounts } from "./lib/nav-api.ts";
import { useUnreadNotificationCount } from "./lib/notifications-api.ts";

const collapsedStorageKey = "overture.rail";

export function AppShell() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const navCounts = useNavCounts();
  const unreadNotifications = useUnreadNotificationCount();
  const desktop = useMediaQuery("(min-width: 1280px)");
  const [searchOpen, setSearchOpen] = useState(false);

  const [railCollapsed, setRailCollapsed] = useState(() => {
    const stored = globalThis.localStorage.getItem(collapsedStorageKey);

    return stored === "1";
  });

  useLiveUpdates();

  useEffect(() => {
    if (!isPending && session === null) {
      void navigate("/signin");
    }
  }, [isPending, navigate, session]);

  if (isPending || session === null) {
    return <RouteFallback fullScreen />;
  }

  const wide = desktop && !railCollapsed;

  const toggleRail = () => {
    setRailCollapsed((current) => {
      globalThis.localStorage.setItem(collapsedStorageKey, current ? "0" : "1");

      return !current;
    });
  };

  return (
    <div className="relative overflow-x-clip bg-background text-foreground">
      <Backdrop />
      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        {wide ? (
          <aside
            className="fixed left-0 top-0 z-20 flex h-dvh w-[268px] flex-col gap-2 overflow-visible border-r border-border bg-sidebar px-4 pb-2.5 pt-3.5 min-[1700px]:w-[296px]"
            data-shell-sidebar
          >
            <div className="flex items-center justify-between px-1.5">
              <Link
                aria-label={copy.brand.homeAria}
                className="flex items-center gap-2.5 transition hover:opacity-80"
                to="/home"
              >
                <BrandMark size={30} />
                <span className="font-serif text-card-title leading-none text-foreground">
                  {copy.app.name}
                </span>
              </Link>
              <Button
                ariaLabel={copy.shell.collapseSidebar}
                className="h-9 w-9"
                onClick={toggleRail}
                size="icon"
                variant="ghost"
              >
                <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
            <Separator />
            <SidebarSearchButton
              onOpen={() => {
                setSearchOpen(true);
              }}
            />
            <Separator />
            <div className="flex flex-1 flex-col">
              <SideNav counts={navCounts} showLabels unreadNotifications={unreadNotifications} />
            </div>
            <div className="mt-auto flex flex-col gap-1.5">
              <SidebarThemeToggle />
              <UsageCard />
            </div>
          </aside>
        ) : (
          <BoardRail
            counts={navCounts}
            onExpand={toggleRail}
            onOpenSearch={() => {
              setSearchOpen(true);
            }}
            unreadNotifications={unreadNotifications}
          />
        )}
        <div
          aria-hidden="true"
          className={
            wide
              ? "hidden w-[268px] flex-none min-[1700px]:w-[296px] xl:block"
              : "hidden w-[76px] flex-none md:block"
          }
        />
        <main
          className="min-w-0 flex-1 px-4 pb-7 pt-5 outline-none md:px-7 md:pb-10 md:pt-7 min-[1700px]:px-14 min-[1700px]:pt-8"
          id="main-content"
          tabIndex={-1}
        >
          <div className="mx-auto w-full max-w-[1440px]">
            <RouteErrorBoundary insideShell>
              <Suspense fallback={<RouteFallback />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
        <TabBar
          counts={navCounts}
          onOpenSearch={() => {
            setSearchOpen(true);
          }}
          unreadNotifications={unreadNotifications}
        />
      </div>
      <WorkspaceSearchDialog onOpenChange={setSearchOpen} open={searchOpen} />
      <Toaster />
    </div>
  );
}
