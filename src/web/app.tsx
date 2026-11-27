import { Suspense, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Outlet, useLocation, useNavigate } from "react-router";

import { Backdrop } from "./components/backdrop.tsx";
import { BoardRail } from "./components/board-rail.tsx";
import { MobileTopHeader } from "./components/mobile-top-header.tsx";
import { RouteErrorBoundary } from "./components/route-error-boundary.tsx";
import { RouteFallback } from "./components/route-fallback.tsx";
import { SidebarContent } from "./components/sidebar-content.tsx";
import { SidebarDrawer } from "./components/sidebar-drawer.tsx";
import { TabBar } from "./components/tab-bar.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { WorkspaceSearchDialog } from "./components/workspace-search-dialog.tsx";
import { authClient } from "./lib/auth-client.ts";
import { useLiveUpdates } from "./lib/live-events.ts";
import { useMediaQuery } from "./lib/media-query.ts";
import { useNavCounts } from "./lib/nav-api.ts";
import { useUnreadNotificationCount } from "./lib/notifications-api.ts";
import { useOnboardingState } from "./lib/onboarding-api.ts";
import { closeAllTopLayerHosts, useTopLayerHost } from "./lib/top-layer-host.ts";

const collapsedStorageKey = "overture.rail";

const UNONBOARDED_ALLOWED_PATHS = new Set([
  "/profile/account",
  "/profile/billing",
  "/settings",
  "/settings/billing",
  "/settings/billing/plans",
  "/settings/delete",
  "/settings/export",
  "/settings/support-access",
]);

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session, isPending } = authClient.useSession();
  const onboarding = useOnboardingState(session !== null);
  const navCounts = useNavCounts();
  const unreadNotifications = useUnreadNotificationCount();
  const desktop = useMediaQuery("(min-width: 1280px)");
  const overlayHost = useTopLayerHost();
  const [searchOpen, setSearchOpen] = useState(false);
  const [tabletDrawerOpen, setTabletDrawerOpen] = useState(false);

  const changeSearchOpen = useCallback((open: boolean) => {
    if (open) {
      closeAllTopLayerHosts();
    }

    setSearchOpen(open);
  }, []);

  const openSearch = useCallback(() => {
    changeSearchOpen(true);
  }, [changeSearchOpen]);

  const [railCollapsed, setRailCollapsed] = useState(() => {
    const stored = globalThis.localStorage.getItem(collapsedStorageKey);

    return stored === "1";
  });

  useLiveUpdates();

  const allowUnonboarded = UNONBOARDED_ALLOWED_PATHS.has(location.pathname);
  const onboardingBlocked = onboarding.data?.needsOnboarding === true && !allowUnonboarded;
  const waitingForOnboarding = session !== null && onboarding.isPending && !allowUnonboarded;

  useEffect(() => {
    if (!isPending && session === null) {
      void navigate("/signin");
    } else if (onboardingBlocked) {
      void navigate("/onboarding", { replace: true });
    }
  }, [isPending, navigate, onboardingBlocked, session]);

  if (isPending || session === null || waitingForOnboarding || onboardingBlocked) {
    return <RouteFallback fullScreen />;
  }

  const wide = desktop && !railCollapsed;
  const drawerOpen = !desktop && tabletDrawerOpen;

  const toggleDesktopRail = () => {
    setRailCollapsed((current) => {
      globalThis.localStorage.setItem(collapsedStorageKey, current ? "0" : "1");

      return !current;
    });
  };

  const handleExpand = () => {
    if (desktop) {
      toggleDesktopRail();

      return;
    }

    setTabletDrawerOpen(true);
  };

  const handleCollapse = () => {
    if (desktop) {
      toggleDesktopRail();

      return;
    }

    setTabletDrawerOpen(false);
  };

  return (
    <div className="relative overflow-x-clip bg-background text-foreground">
      <Backdrop />
      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <MobileTopHeader onOpenSearch={openSearch} unreadNotifications={unreadNotifications} />
        {wide ? (
          <aside
            className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border bg-sidebar xl:flex 2xl:w-72"
            data-shell-sidebar
          >
            <SidebarContent
              counts={navCounts}
              onCollapse={handleCollapse}
              onOpenSearch={openSearch}
              unreadNotifications={unreadNotifications}
            />
          </aside>
        ) : (
          <BoardRail
            counts={navCounts}
            onExpand={handleExpand}
            onOpenSearch={openSearch}
            unreadNotifications={unreadNotifications}
          />
        )}
        <div
          aria-hidden="true"
          className={
            wide ? "hidden w-64 flex-none xl:block 2xl:w-72" : "hidden w-18 flex-none md:block"
          }
        />
        <main
          className="flex min-w-0 flex-1 flex-col px-4 pb-6 pt-5 outline-none md:px-7 md:pb-6 md:pt-6 2xl:px-14 2xl:pt-7"
          id="main-content"
          tabIndex={-1}
        >
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
            <RouteErrorBoundary insideShell>
              <Suspense fallback={<RouteFallback />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
        <TabBar counts={navCounts} />
      </div>
      <SidebarDrawer
        counts={navCounts}
        onOpenChange={setTabletDrawerOpen}
        onOpenSearch={openSearch}
        open={drawerOpen}
        unreadNotifications={unreadNotifications}
      />
      <WorkspaceSearchDialog onOpenChange={changeSearchOpen} open={searchOpen} />
      {overlayHost === null ? <Toaster /> : createPortal(<Toaster />, overlayHost)}
    </div>
  );
}
