import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * One Home section row that opens the item it names.
 *
 * @param props Row content and destination.
 * @param props.meta Secondary line under the title.
 * @param props.title The row's primary line.
 * @param props.to Where the row opens.
 * @param props.trailing Optional badge or timestamp placed before the chevron.
 * @returns The linked row.
 */
export function HomeSectionRow({
  meta,
  title,
  to,
  trailing,
}: {
  meta?: ReactNode;
  title: ReactNode;
  to: string;
  trailing?: ReactNode;
}) {
  return (
    <Link
      className="group -mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2 transition hover:bg-muted"
      to={to}
    >
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{title}</p>
        {meta === undefined ? null : (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        )}
      </div>
      {trailing}
      <ChevronRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </Link>
  );
}
