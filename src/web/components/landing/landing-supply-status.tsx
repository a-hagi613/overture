import { Button } from "../ui/button.tsx";
import { dsMono } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";

/**
 * The live number, its sentence and the retry action. Keeps a compact horizontal readout bar so
 * loading, failing and a fresh count never move the sections below.
 * @param props The formatted value, caption, live flag and retry state.
 * @param props.caption The sentence next to the number for the current state.
 * @param props.live Whether the count is live, which draws the orange live dot.
 * @param props.onRetry Called when the visitor asks for the count again after a failure.
 * @param props.retryVisible Whether the retry button replaces the timestamp line.
 * @param props.updatedAt The local time the count was generated, or null before the first answer.
 * @param props.value The formatted count, or an em dash before the first answer.
 * @returns The count readout bar inside the supply preview card.
 */
export function LandingSupplyStatus({
  caption,
  live,
  onRetry,
  retryVisible,
  updatedAt,
  value,
}: {
  caption: string;
  live: boolean;
  onRetry: () => void;
  retryVisible: boolean;
  updatedAt: string | null;
  value: string;
}) {
  return (
    <div
      aria-live="polite"
      className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-border/70 bg-muted/55 px-5 py-3.5"
      data-testid="supply-status"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {live ? (
          <span
            aria-hidden="true"
            className="relative flex h-2.5 w-2.5 flex-none self-center items-center justify-center"
          >
            <span className="absolute inset-0 rounded-full bg-signal animate-live-ping" />
            <span className="relative h-2 w-2 rounded-full bg-signal ring-2 ring-signal-soft" />
          </span>
        ) : null}
        <span
          className="font-serif text-card-title leading-none tabular-nums text-foreground"
          data-testid="supply-count"
        >
          {value}
        </span>
        <p className="text-sm text-muted-foreground" data-testid="supply-caption">
          {caption}
        </p>
      </div>
      <div className="flex min-h-8 items-center">
        {retryVisible ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            {LANDING_COPY.supply.retry}
          </Button>
        ) : (
          <span className={dsMono}>
            {updatedAt === null ? "" : `${LANDING_COPY.supply.liveLabel} ${updatedAt}`}
          </span>
        )}
      </div>
    </div>
  );
}
