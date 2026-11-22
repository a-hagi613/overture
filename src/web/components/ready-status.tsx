import { copy } from "../../shared/copy.ts";

type ReadyStatusProps =
  | { variant: "loading" }
  | { busy: boolean; onRetry: () => void; variant: "stale" | "failed" };

const skeletonRows = [0, 1];

export function ReadyStatus(props: ReadyStatusProps) {
  if (props.variant === "loading") {
    return (
      <output
        aria-busy="true"
        aria-label={copy.ready.loading}
        className="mt-[22px] flex flex-col gap-4"
      >
        {skeletonRows.map((key) => (
          <div
            aria-hidden="true"
            className="rounded-lg border border-border bg-card px-[18px] py-4 shadow-sh"
            key={key}
          >
            <div className="h-4 w-2/5 rounded bg-muted" />
            <div className="mt-3 h-3 w-1/4 rounded bg-muted" />
            <div className="mt-4 h-3 w-full rounded bg-muted" />
          </div>
        ))}
      </output>
    );
  }

  const retryButton = (
    <button
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-card px-4 text-[13.5px] font-semibold hover:bg-muted"
      onClick={props.onRetry}
      type="button"
    >
      {props.busy ? copy.ready.retrying : copy.ready.retry}
    </button>
  );

  if (props.variant === "stale") {
    return (
      <section
        className="mt-[22px] flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-lg border border-need bg-need-soft px-5 py-4 shadow-sh"
        role="alert"
      >
        <p className="text-[14px] font-semibold leading-[1.5] text-need">
          {copy.ready.staleWarning}
        </p>
        {retryButton}
      </section>
    );
  }

  return (
    <section
      className="mt-[22px] flex flex-col items-start gap-2.5 rounded-lg border border-need bg-need-soft px-6 py-6 shadow-sh max-md:px-4"
      role="alert"
    >
      <h2 className="font-serif text-[26px] leading-[1.15]">{copy.ready.loadFailedTitle}</h2>
      <p className="text-[13.5px] text-muted-foreground">{copy.ready.loadFailedBody}</p>
      {retryButton}
    </section>
  );
}
