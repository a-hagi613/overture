import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import {
  useCalendarFeed,
  useIssueCalendarFeed,
  useRevokeCalendarFeed,
} from "../lib/calendar-feed-api.ts";

const BUTTON =
  "inline-flex min-h-11 flex-none cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60";

function feedOnStatus(hasLink: boolean) {
  return hasLink ? copy.settings.calendarFeedNewLink : copy.settings.calendarFeedOn;
}

/**
 * The Calendar feed card in Settings (ADR 0034, M4). The link is shown once, when the feed is turned on or rotated,
 * because only its hash is stored. Rotating or turning off makes the old link stop working at once.
 * @returns The Settings section.
 */
export function SettingsCalendarFeed() {
  const status = useCalendarFeed();
  const issue = useIssueCalendarFeed();
  const revoke = useRevokeCalendarFeed();
  const [path, setPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const enabled = status.data?.enabled === true;
  const busy = status.isPending || issue.isPending || revoke.isPending;
  const url = path === null ? null : `${globalThis.location.origin}${path}`;
  const saveFailed = issue.isError || revoke.isError;

  const turnOnOrRotate = () => {
    setCopied(false);
    setCopyFailed(false);
    issue.mutate(undefined, {
      onSuccess: (body) => {
        setPath(body.path);
      },
    });
  };

  const turnOff = () => {
    setCopied(false);
    setCopyFailed(false);
    revoke.mutate(undefined, {
      onSuccess: () => {
        setPath(null);
      },
    });
  };

  const copyLink = async () => {
    if (url === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  const statusLine = !status.isPending && enabled ? feedOnStatus(url !== null) : "";

  let turnOnLabel: string = copy.settings.calendarFeedTurnOn;

  if (issue.isPending) {
    turnOnLabel = copy.settings.calendarFeedPending;
  } else if (enabled) {
    turnOnLabel = copy.settings.calendarFeedRotate;
  }

  return (
    <section
      aria-labelledby="settings-calendar-feed"
      className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      data-testid="settings-calendar-feed"
    >
      <h2 className="font-serif text-[26px] leading-[1.1]" id="settings-calendar-feed">
        {copy.settings.calendarFeedHeading}
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.settings.calendarFeedIntro}</p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {copy.settings.calendarFeedPrivacy}
      </p>

      {status.isError ? (
        <p className="mt-3 text-[12.5px] leading-[1.5] text-need" role="alert">
          {copy.settings.calendarFeedLoadError}
        </p>
      ) : (
        <div className="mt-3.5 border-t border-border pt-3.5">
          {statusLine === "" ? null : (
            <p className="text-[12.5px] leading-[1.5] text-muted-foreground">{statusLine}</p>
          )}

          {url === null ? null : (
            <div className="mt-3 flex flex-col gap-2.5">
              <label className="text-[12.5px] font-semibold" htmlFor="calendar-feed-url">
                {copy.settings.calendarFeedUrlLabel}
              </label>
              <input
                className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3.5 font-mono text-[12.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                id="calendar-feed-url"
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
                readOnly
                type="text"
                value={url}
              />
              <div className="flex items-center justify-between gap-4">
                <p className="min-w-0 text-[12.5px] text-muted-foreground">
                  {copy.settings.calendarFeedHowTo}
                </p>
                <button
                  className={BUTTON}
                  onClick={() => {
                    void copyLink();
                  }}
                  type="button"
                >
                  <NavGlyph name="copy" size={14} />
                  {copied ? copy.settings.calendarFeedCopied : copy.settings.calendarFeedCopy}
                </button>
                <output className="sr-only">
                  {copied ? copy.settings.calendarFeedCopied : ""}
                </output>
              </div>
              {copyFailed ? (
                <output className="block text-[12.5px] leading-[1.5] text-need">
                  {copy.settings.calendarFeedCopyFailed}
                </output>
              ) : null}
            </div>
          )}

          <div className="mt-3.5 flex items-center justify-between gap-4 border-t border-border pt-3.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {enabled ? copy.settings.calendarFeedRotate : copy.settings.calendarFeedTurnOn}
              </p>
              <p className="text-[12.5px] text-muted-foreground">
                {enabled ? copy.settings.calendarFeedRotateDetail : copy.settings.calendarFeedOff}
              </p>
            </div>
            <button
              aria-busy={issue.isPending}
              className={BUTTON}
              disabled={busy}
              onClick={turnOnOrRotate}
              type="button"
            >
              {turnOnLabel}
            </button>
          </div>

          {enabled ? (
            <div className="mt-3.5 flex items-center justify-between gap-4 border-t border-border pt-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{copy.settings.calendarFeedRevoke}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {copy.settings.calendarFeedRevokeDetail}
                </p>
              </div>
              <button
                aria-busy={revoke.isPending}
                className={`${BUTTON} border-need text-need hover:bg-need-soft`}
                disabled={busy}
                onClick={turnOff}
                type="button"
              >
                {revoke.isPending
                  ? copy.settings.calendarFeedPending
                  : copy.settings.calendarFeedRevoke}
              </button>
            </div>
          ) : null}

          {saveFailed ? (
            <p className="mt-2 text-[12.5px] leading-[1.5] text-need" role="alert">
              {copy.settings.calendarFeedSaveError}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
