import { copy } from "../../../shared/copy.ts";
import type { AttemptLive, AttemptReplay, AttemptRow } from "../../lib/admin-api.ts";
import { AttemptInspectLive } from "./attempt-inspect-live.tsx";
import { safeExternalHttpUrl } from "./attempts-format.ts";

export type AttemptInspectState =
  | { attempt: AttemptRow; kind: "live"; status: "loading" }
  | { attempt: AttemptRow; kind: "live"; status: "ready"; data: AttemptLive }
  | { attempt: AttemptRow; kind: "replay"; status: "loading" }
  | { attempt: AttemptRow; kind: "replay"; status: "ready"; data: AttemptReplay }
  | { attempt: AttemptRow; kind: "live" | "replay"; status: "unavailable" }
  | { attempt: AttemptRow; kind: "live" | "replay"; status: "error" };

const EXTERNAL_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md border border-foreground bg-foreground px-4 text-sm font-semibold text-primary-ink hover:bg-btn-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-10";

export function AttemptInspectPanel({
  onClose,
  state,
}: {
  onClose: () => void;
  state: AttemptInspectState;
}) {
  const heading =
    state.kind === "live"
      ? copy.admin.attemptsInspectLiveHeading(state.attempt.postingTitle)
      : copy.admin.attemptsInspectReplayHeading(state.attempt.postingTitle);

  const safeReplayUrl =
    state.status === "ready" && state.kind === "replay"
      ? safeExternalHttpUrl(state.data.recordingUrl)
      : null;

  return (
    <section
      aria-labelledby="admin-attempt-inspect-heading"
      aria-live="polite"
      className="mt-5 rounded-lg border border-input bg-card p-5 shadow-sh"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            className="font-serif text-card-title leading-[1.15]"
            id="admin-attempt-inspect-heading"
          >
            {heading}
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {state.attempt.companyName}
          </p>
        </div>
        <button
          className="min-h-11 min-w-11 rounded-md border border-input bg-card px-3.5 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
          onClick={onClose}
          type="button"
        >
          {copy.admin.attemptsInspectClose}
        </button>
      </div>
      {state.status === "loading" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {state.kind === "live"
            ? copy.admin.attemptsInspectLoadingLive
            : copy.admin.attemptsInspectLoadingReplay}
        </p>
      ) : null}
      {state.status === "unavailable" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {copy.admin.attemptsInspectUnavailable}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="mt-3 text-sm text-need">{copy.admin.attemptsInspectFailed}</p>
      ) : null}
      {state.status === "ready" && state.kind === "live" ? (
        <AttemptInspectLive data={state.data} />
      ) : null}
      {state.status === "ready" && state.kind === "replay" && safeReplayUrl === null ? (
        <p className="mt-3 text-sm text-need">{copy.admin.attemptsInspectUnsafeUrl}</p>
      ) : null}
      {state.status === "ready" && state.kind === "replay" && safeReplayUrl !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            className={EXTERNAL_LINK_CLASS}
            href={safeReplayUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {copy.admin.attemptsInspectOpenReplay}
          </a>
        </div>
      ) : null}
    </section>
  );
}
