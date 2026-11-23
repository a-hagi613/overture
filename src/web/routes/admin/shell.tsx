import { Suspense } from "react";
import { Outlet } from "react-router";

import type { Me } from "../../lib/me-api.ts";

import { copy } from "../../../shared/copy.ts";
import { BrandMark } from "../../components/brand-mark.tsx";
import { NavGlyph } from "../../components/nav-glyph.tsx";
import { RouteFallback } from "../../components/route-fallback.tsx";
import { isCrossOrigin, useMeQuery } from "../../lib/me-api.ts";
import { AdminChipNav } from "./admin-chip-nav.tsx";
import { AdminSideNav } from "./admin-nav.tsx";
import { AdminSideIdentity } from "./admin-side.tsx";
import { AdminHandoffCard } from "./handoff-card.tsx";

function ownerHandoffOrigin(me: Me | undefined) {
  const adminOrigin = me?.adminOrigin ?? null;

  if (me?.user?.role !== "owner" || adminOrigin === null) {
    return null;
  }

  return isCrossOrigin(adminOrigin, globalThis.location.origin) ? adminOrigin : null;
}

export function AdminShell() {
  const { data: me, isPending } = useMeQuery();

  if (isPending) {
    return <RouteFallback fullScreen />;
  }

  const handoffOrigin = ownerHandoffOrigin(me);

  if (handoffOrigin !== null) {
    return <AdminHandoffCard adminOrigin={handoffOrigin} />;
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] items-stretch">
        <aside className="hidden w-[244px] shrink-0 flex-col border-r border-border bg-sidebar px-4 pb-6 pt-[26px] lg:flex">
          <div className="flex items-center gap-2.5 px-1.5">
            <BrandMark size={30} />
            <span className="font-serif text-[27px] leading-none tracking-tight">
              {copy.app.name}
            </span>
            <span aria-hidden="true" className="ml-auto text-muted-foreground">
              <NavGlyph name="rail" size={18} />
            </span>
          </div>
          <span className="mt-3 inline-flex items-center self-start rounded-full bg-signal-soft px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-need">
            {copy.admin.adminPill}
          </span>
          <AdminSideNav />
          <div className="mt-auto pt-8">
            <AdminSideIdentity />
          </div>
        </aside>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 outline-none px-4 pb-10 pt-4 md:px-[31px] md:pt-[26px]"
        >
          <AdminChipNav />
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
