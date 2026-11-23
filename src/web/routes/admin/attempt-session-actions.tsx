import { copy } from "../../../shared/copy.ts";
import type { AttemptRow } from "../../lib/admin-api.ts";
import { isActiveAttempt } from "./attempts-format.ts";

const ACTION_BUTTON_CLASS =
  "min-h-11 rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9";

const LIVE_BUTTON_CLASS =
  "min-h-11 rounded-md border border-foreground bg-foreground px-3 text-[12.5px] font-semibold text-primary-ink hover:bg-btn-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9";

export function AttemptSessionActions({
  attempt,
  onInspectLive,
  onInspectReplay,
}: {
  attempt: AttemptRow;
  onInspectLive: (attempt: AttemptRow) => void;
  onInspectReplay: (attempt: AttemptRow) => void;
}) {
  if (attempt.providerSessionId === null) {
    return (
      <span className="text-[12px] text-muted-foreground">
        {copy.admin.attemptsActionUnavailable}
      </span>
    );
  }

  const active = isActiveAttempt(attempt);

  return (
    <div className="flex flex-wrap gap-2">
      {active ? (
        <button
          className={LIVE_BUTTON_CLASS}
          onClick={() => {
            onInspectLive(attempt);
          }}
          type="button"
        >
          {copy.admin.attemptsActionWatchLive}
        </button>
      ) : null}
      <button
        className={ACTION_BUTTON_CLASS}
        onClick={() => {
          onInspectReplay(attempt);
        }}
        type="button"
      >
        {copy.admin.attemptsActionViewReplay}
      </button>
    </div>
  );
}
