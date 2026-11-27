import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";

/**
 * The Matches footer pager, shown only when there is more than one page.
 *
 * @param props The current page, the page count and the page change handler.
 * @param props.onChange Called with the page the person wants next.
 * @param props.page The page on screen.
 * @param props.totalPages How many pages the match list holds.
 * @returns The pager, or nothing for a single page.
 */
export function MatchesPager({
  onChange,
  page,
  totalPages,
}: {
  onChange: (page: number) => void;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span aria-live="polite" className="font-mono text-xs tabular-nums text-muted-foreground">
        {copy.matches.pager.label(page, totalPages)}
      </span>
      <div className="flex items-center gap-2">
        <Button
          disabled={page <= 1}
          onClick={() => {
            onChange(page - 1);
          }}
          size="sm"
          variant="outline"
        >
          {copy.matches.pager.previous}
        </Button>
        <Button
          disabled={page >= totalPages}
          onClick={() => {
            onChange(page + 1);
          }}
          size="sm"
          variant="outline"
        >
          {copy.matches.pager.next}
        </Button>
      </div>
    </div>
  );
}
