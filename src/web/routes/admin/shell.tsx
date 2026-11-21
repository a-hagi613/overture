import { Outlet } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { BrandMark } from "../../components/brand-mark.tsx";
import { NavGlyph } from "../../components/nav-glyph.tsx";
import { AdminChipNav } from "./admin-chip-nav.tsx";
import { AdminSideNav } from "./admin-nav.tsx";
import { AdminSideIdentity } from "./admin-side.tsx";

export function AdminShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
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
        <main className="min-w-0 flex-1 px-4 pb-10 pt-4 md:px-[31px] md:pt-[26px]">
          <AdminChipNav />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
