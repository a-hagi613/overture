import { copy } from "../../../shared/copy.ts";
import { NavGlyph } from "../../components/nav-glyph.tsx";

export function ExternalDashboardLink({ href, id }: { href: string; id: string }) {
  const { label, note } = copy.admin.dashboardsLink(id);

  return (
    <a
      className="group flex items-start justify-between gap-3 border-t border-border py-3 first:border-t-0 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      data-testid={`admin-dashboard-${id}`}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold group-hover:underline">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{note}</span>
      </span>
      <span className="flex-none text-muted-foreground">
        <NavGlyph name="link" size={15} />
      </span>
    </a>
  );
}
