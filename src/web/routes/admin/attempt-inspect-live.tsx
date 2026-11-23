import { copy } from "../../../shared/copy.ts";
import type { AttemptLive } from "../../lib/admin-api.ts";
import { safeExternalHttpUrl } from "./attempts-format.ts";

const EXTERNAL_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md border border-foreground bg-foreground px-4 text-[13px] font-semibold text-primary-ink hover:bg-btn-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-10";

const SECONDARY_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md border border-input bg-card px-4 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-10";

export function AttemptInspectLive({ data }: { data: AttemptLive }) {
  const safeLive = safeExternalHttpUrl(data.liveViewUrl);
  const safeRecording = safeExternalHttpUrl(data.recordingUrl);
  const unsafeLive = data.liveViewUrl !== null && safeLive === null;

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
            data.status === "active"
              ? "bg-signal-soft text-signal-text"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {data.status === "active"
            ? copy.admin.attemptsInspectStatusActive
            : copy.admin.attemptsInspectStatusStopped}
        </span>
      </div>
      {unsafeLive ? (
        <p className="text-[13px] text-need">{copy.admin.attemptsInspectUnsafeUrl}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {safeLive === null ? null : (
          <a
            className={EXTERNAL_LINK_CLASS}
            href={safeLive}
            rel="noopener noreferrer"
            target="_blank"
          >
            {copy.admin.attemptsInspectOpenLive}
          </a>
        )}
        {safeLive === null && !unsafeLive ? (
          <p className="text-[13px] text-muted-foreground">{copy.admin.attemptsInspectNoLiveUrl}</p>
        ) : null}
        {safeRecording === null ? null : (
          <a
            className={SECONDARY_LINK_CLASS}
            href={safeRecording}
            rel="noopener noreferrer"
            target="_blank"
          >
            {copy.admin.attemptsInspectOpenReplay}
          </a>
        )}
      </div>
    </div>
  );
}
