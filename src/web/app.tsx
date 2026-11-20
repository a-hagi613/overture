import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";

import { copy } from "../shared/copy.ts";
import { NavGlyph } from "./components/nav-glyph.tsx";
import { AvatarLink } from "./components/avatar-link.tsx";
import { Backdrop } from "./components/backdrop.tsx";
import { BrandMark } from "./components/brand-mark.tsx";
import { SideNav } from "./components/side-nav.tsx";
import { TabBar } from "./components/tab-bar.tsx";
import { UsageCard } from "./components/usage.tsx";
import { UsageMini } from "./components/usage-mini.tsx";
import { authClient } from "./lib/auth-client.ts";

const collapsedStorageKey = "overture.rail";

export function AppShell() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const name = session?.user.name ?? null;

  const [railCollapsed, setRailCollapsed] = useState(
    () => globalThis.localStorage.getItem(collapsedStorageKey) === "1",
  );

  useEffect(() => {
    if (!isPending && session === null) {
      void navigate("/signin");
    }
  }, [isPending, navigate, session]);

  if (isPending) {
    return <div className="min-h-screen bg-background" />;
  }

  if (session === null) {
    return null;
  }

  const wide = !railCollapsed;
  const columnWidths = wide ? "md:w-[76px] lg:w-[268px]" : "md:w-[76px] lg:w-[76px]";

  const toggleRail = () => {
    setRailCollapsed((current) => {
      globalThis.localStorage.setItem(collapsedStorageKey, current ? "0" : "1");

      return !current;
    });
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <Backdrop />
      <aside
        className={`hidden border-r border-border bg-sidebar px-4 pb-[18px] pt-[22px] md:flex md:flex-col md:items-center md:gap-[18px] lg:items-stretch ${columnWidths}`}
      >
        <div className={`flex items-center justify-between px-1.5 ${wide ? "" : "justify-center"}`}>
          <Link aria-label={copy.brand.homeAria} className="flex items-center gap-2.5" to="/">
            <BrandMark size={30} />
            {wide ? (
              <span className="font-serif text-[27px] leading-none tracking-tight">
                {copy.app.name}
              </span>
            ) : null}
          </Link>
          {wide ? (
            <button
              aria-label={copy.shell.collapseSidebar}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={toggleRail}
              type="button"
            >
              <NavGlyph name="rail" size={18} />
            </button>
          ) : null}
        </div>
        <hr className="m-0 border-border shadow-[0_1px_0_var(--color-bloom)]" />
        <SideNav showLabels={wide} />
        <div className="mt-auto flex flex-col gap-3.5">
          {wide ? <UsageCard /> : <UsageMini />}
          <AvatarLink name={name} wide={wide} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-7 pt-[18px] md:px-9 md:pb-10 md:pt-[26px]">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
