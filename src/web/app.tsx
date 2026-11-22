import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { copy } from "../shared/copy.ts";
import { LandingPage } from "./routes/landing.tsx";
import { NavGlyph } from "./components/nav-glyph.tsx";
import { AvatarLink } from "./components/avatar-link.tsx";
import { BoardRail } from "./components/board-rail.tsx";
import { Backdrop } from "./components/backdrop.tsx";
import { BrandMark } from "./components/brand-mark.tsx";
import { SideNav } from "./components/side-nav.tsx";
import { TabBar } from "./components/tab-bar.tsx";
import { UsageCard } from "./components/usage.tsx";
import { authClient } from "./lib/auth-client.ts";
import { useLiveUpdates } from "./lib/live-events.ts";
import { useMediaQuery } from "./lib/media-query.ts";
import { useNavCounts } from "./lib/nav-api.ts";

const collapsedStorageKey = "overture.rail";

export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: session, isPending } = authClient.useSession();
  const name = session?.user.name ?? null;
  const navCounts = useNavCounts();
  const desktop = useMediaQuery("(min-width: 1280px)");

  const [railCollapsed, setRailCollapsed] = useState(() => {
    const stored = globalThis.localStorage.getItem(collapsedStorageKey);

    return stored === "1" || (stored === null && pathname === "/board");
  });

  useLiveUpdates();

  useEffect(() => {
    if (!isPending && session === null && pathname !== "/") {
      void navigate("/signin");
    }
  }, [isPending, navigate, pathname, session]);

  if (pathname === "/" && (isPending || session === null)) {
    return <LandingPage />;
  }

  if (isPending) {
    return <div className="min-h-screen bg-background" />;
  }

  if (session === null) {
    return null;
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
      <div className="relative z-[1] flex min-h-screen flex-col md:flex-row">
        {wide ? (
          <aside
            className="fixed left-0 top-0 z-20 flex h-dvh w-[268px] flex-col gap-[18px] border-r border-border bg-sidebar px-4 pb-[18px] pt-[22px] min-[1700px]:w-[300px]"
            data-shell-sidebar
          >
            <div className="flex items-center justify-between px-1.5">
              <Link aria-label={copy.brand.homeAria} className="flex items-center gap-2.5" to="/">
                <BrandMark size={30} />
                <span className="font-serif text-[27px] leading-none tracking-tight">
                  {copy.app.name}
                </span>
              </Link>
              <button
                aria-label={copy.shell.collapseSidebar}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={toggleRail}
                type="button"
              >
                <NavGlyph name="rail" size={18} />
              </button>
            </div>
            <hr className="m-0 border-border shadow-[0_1px_0_var(--color-bloom)]" />
            <div
              className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1"
              data-scroll-region
            >
              <SideNav counts={navCounts} showLabels />
            </div>
            <div className="flex flex-col gap-3.5">
              <UsageCard />
              <AvatarLink name={name} wide />
            </div>
          </aside>
        ) : (
          <BoardRail counts={navCounts} name={name} onExpand={toggleRail} />
        )}
        <div
          aria-hidden="true"
          className={
            wide
              ? "hidden w-[268px] flex-none min-[1700px]:w-[300px] xl:block"
              : "hidden w-[76px] flex-none md:block"
          }
        />
        <main
          data-shell-main
          className={
            pathname === "/board"
              ? "min-w-0 flex-1"
              : "shell-main min-w-0 flex-1 px-4 pb-7 pt-[18px] md:px-9 md:pb-10 md:pt-[26px]"
          }
        >
          <div className={pathname === "/board" ? undefined : "mx-auto w-full max-w-[1440px]"}>
            <Outlet />
          </div>
        </main>
        <TabBar counts={navCounts} />
      </div>
    </div>
  );
}
