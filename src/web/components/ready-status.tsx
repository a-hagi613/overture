import { AlertCircle } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

type ReadyStatusProps =
  | { variant: "loading" }
  | { busy: boolean; onRetry: () => void; variant: "stale" | "failed" };

const skeletonRows = [0, 1];

export function ReadyStatus(props: ReadyStatusProps) {
  if (props.variant === "loading") {
    return (
      <output aria-busy="true" aria-label={copy.ready.loading} className="mt-6 flex flex-col gap-4">
        {skeletonRows.map((key) => (
          <Card className="p-5" key={key}>
            <div className="h-4 w-2/5 rounded bg-muted" />
            <div className="mt-3 h-3 w-1/4 rounded bg-muted" />
            <div className="mt-4 h-3 w-full rounded bg-muted" />
          </Card>
        ))}
      </output>
    );
  }

  const retryButton = (
    <Button disabled={props.busy} onClick={props.onRetry} size="default" variant="secondary">
      {props.busy ? copy.ready.retrying : copy.ready.retry}
    </Button>
  );

  if (props.variant === "stale") {
    return (
      <Card
        className="mt-5 flex flex-wrap items-center justify-between gap-4 border-need/30 bg-need-soft/60 p-4"
        variant="default"
      >
        <div className="flex items-center gap-2.5 text-sm font-semibold text-need" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <span>{copy.ready.staleWarning}</span>
        </div>
        {retryButton}
      </Card>
    );
  }

  return (
    <Card className="mt-6 border-need/30 bg-need-soft/60 p-6" variant="default">
      <div className="flex flex-col items-start gap-2.5" role="alert">
        <h2 className={dsCardTitle}>{copy.ready.loadFailedTitle}</h2>
        <p className={dsBody}>{copy.ready.loadFailedBody}</p>
        {retryButton}
      </div>
    </Card>
  );
}
