import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { BrandMark } from "../../components/brand-mark.tsx";
import { NavGlyph } from "../../components/nav-glyph.tsx";
import { useTheme } from "../../lib/theme-context.ts";

export function AdminHeader() {
  const { theme, toggleTheme, label } = useTheme();

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="flex items-center gap-2.5">
        <BrandMark size={30} />
        <span className="font-serif text-[27px] leading-none tracking-tight">{copy.app.name}</span>
        <span className="ml-1 rounded-full border border-input bg-muted px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {copy.admin.area}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Link
          className="rounded-md border border-input bg-card px-3.5 py-2 text-[13.5px] font-semibold hover:bg-muted"
          to="/admin"
        >
          {copy.admin.navOverview}
        </Link>
        <Link
          className="rounded-md border border-input bg-card px-3.5 py-2 text-[13.5px] font-semibold hover:bg-muted"
          to="/admin/settings"
        >
          {copy.admin.navSwitches}
        </Link>
        <Link
          className="rounded-md border border-input bg-card px-3.5 py-2 text-[13.5px] font-semibold hover:bg-muted"
          to="/admin/catalog"
        >
          {copy.admin.navCatalog}
        </Link>
        <button
          aria-label={label}
          aria-pressed={theme === "dark"}
          className="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-card hover:bg-muted max-[767px]:h-11 max-[767px]:w-11"
          onClick={toggleTheme}
          type="button"
        >
          {theme === "dark" ? <NavGlyph name="sun" /> : <NavGlyph name="moon" />}
        </button>
      </div>
    </header>
  );
}
