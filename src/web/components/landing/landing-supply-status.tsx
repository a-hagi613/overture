import { Button } from "../ui/button.tsx";
import { dsMetric, dsMono } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";

/**
 * The live number, its sentence and the retry action. Every state occupies the same reserved height, so
 * loading, failing and a fresh count never move the sections below.
 * @param props The formatted value, caption, live flag and retry state.
 * @param props.caption The sentence under the number for the current state.
 * @param props.live Whether the count is live, which draws the orange live dot.
 * @param props.onRetry Called when the visitor asks for the count again after a failure.
 * @param props.retryVisible Whether the retry button replaces the timestamp line.
 * @param props.updatedAt The local time the count was generated, or null before the first answer.
 * @param props.value The formatted count, or an em dash before the first answer.
 * @returns The count block inside the supply preview card.
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
      className="mt-6 min-h-40 border-t border-border pt-5"
      data-testid="supply-status"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="relative flex h-2.5 w-2.5 flex-none items-center justify-center"
        >
          {live ? (
            <>
              <span className="absolute inset-0 rounded-full bg-signal animate-live-ping" />
              <span className="relative h-2 w-2 rounded-full bg-signal ring-2 ring-signal-soft" />
            </>
          ) : null}
        </span>
        <span className={`${dsMetric} tabular-nums text-foreground`} data-testid="supply-count">
          {value}
        </span>
      </div>
      <p
        className="mt-1.5 min-h-12 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground"
        data-testid="supply-caption"
      >
        {caption}
      </p>
      <div className="mt-1 min-h-11">
        {retryVisible ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            {LANDING_COPY.supply.retry}
          </Button>
        ) : (
          <p className={dsMono}>
            {updatedAt === null ? "" : `${LANDING_COPY.supply.liveLabel} · ${updatedAt}`}
          </p>
        )}
      </div>
    </div>
  );
}
