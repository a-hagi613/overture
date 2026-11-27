import { Link } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { useApplyToPosting } from "../lib/matches-api.ts";
import type { MatchRow } from "../lib/matches-api.ts";
import { Button } from "./ui/button.tsx";

/**
 * The Action cell: opens the application a picked job already has, or starts one.
 *
 * @param props The match row the action belongs to.
 * @param props.row The match row the action belongs to.
 * @returns The row's action control.
 */
export function MatchAction({ row }: { row: MatchRow }) {
  const apply = useApplyToPosting();

  if (row.applicationId !== null) {
    return (
      <Button asChild size="xs" variant="outline">
        <Link
          aria-label={copy.matches.viewApplicationAria(row.title)}
          to={`/tracker?application=${encodeURIComponent(row.applicationId)}`}
        >
          {copy.matches.viewApplication}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      ariaBusy={apply.isPending}
      disabled={apply.isPending}
      onClick={() => {
        apply.mutate(row.id, {
          onError: () => {
            toast.error(copy.matches.applyFailed);
          },
        });
      }}
      size="xs"
      variant="primary"
    >
      {apply.isPending ? copy.matches.applying : copy.matches.apply}
    </Button>
  );
}
