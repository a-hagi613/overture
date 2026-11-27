import { useId, useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { MatchRow } from "../lib/matches-api.ts";
import { Button } from "./ui/button.tsx";

/**
 * The Reasons cell: the first stored reason, with the rest one press away.
 *
 * @param props The match row whose stored reasons are shown.
 * @param props.row The match row whose stored reasons are shown.
 * @returns The reasons list and its expand control.
 */
export function MatchReasons({ row }: { row: MatchRow }) {
  const [open, setOpen] = useState(false);
  const reasonsId = useId();
  const shown = open ? row.reasons : row.reasons.slice(0, 1);

  if (row.reasons.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {row.score === null ? copy.matches.scoring : copy.matches.reasonsNone}
      </span>
    );
  }

  return (
    <div className="min-w-0">
      <ul className="space-y-1" id={reasonsId}>
        {shown.map((reason) => (
          <li className="text-xs leading-relaxed text-muted-foreground" key={reason}>
            {reason}
          </li>
        ))}
      </ul>
      {row.reasons.length > 1 ? (
        <Button
          ariaControls={reasonsId}
          ariaExpanded={open}
          ariaLabel={
            open
              ? copy.matches.reasonsHideAria(row.title)
              : copy.matches.reasonsAria(row.title, row.reasons.length)
          }
          className="mt-1 h-auto px-0 text-xs underline decoration-input underline-offset-4 hover:decoration-foreground"
          onClick={() => {
            setOpen((current) => !current);
          }}
          size="xs"
          variant="link"
        >
          {open ? copy.matches.reasonsHide : copy.matches.reasonsShow(row.reasons.length)}
        </Button>
      ) : null}
    </div>
  );
}
