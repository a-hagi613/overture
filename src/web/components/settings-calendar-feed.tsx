import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import {
  useCalendarFeed,
  useIssueCalendarFeed,
  useRevokeCalendarFeed,
} from "../lib/calendar-feed-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

function feedOnStatus(hasLink: boolean) {
  return hasLink ? copy.settings.calendarFeedNewLink : copy.settings.calendarFeedOn;
}

export function SettingsCalendarFeed() {
  const status = useCalendarFeed();
  const issue = useIssueCalendarFeed();
  const revoke = useRevokeCalendarFeed();
  const [path, setPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const enabled = status.data?.enabled === true;
  const busy = status.isPending || issue.isPending || revoke.isPending;
  const url = path === null ? null : `${globalThis.location.origin}${path}`;
  const saveFailed = issue.isError || revoke.isError;

  const turnOnOrRotate = () => {
    setCopied(false);
    issue.mutate(undefined, {
      onSuccess: (body) => {
        setPath(body.path);
        toast.success("Calendar feed link generated.");
      },
    });
  };

  const turnOff = () => {
    setCopied(false);
    revoke.mutate(undefined, {
      onSuccess: () => {
        setPath(null);
        toast.success("Calendar feed turned off.");
      },
    });
  };

  const copyLink = async () => {
    if (url === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(copy.settings.calendarFeedCopied);
    } catch {
      toast.error(copy.settings.calendarFeedCopyFailed);
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
    <Card
      ariaLabelledBy="settings-calendar-feed"
      className="p-5 md:p-6"
      dataTestId="settings-calendar-feed"
    >
      <h2 className={dsCardTitle} id="settings-calendar-feed">
        {copy.settings.calendarFeedHeading}
      </h2>
      <p className={`${dsBody} mt-1 text-xs`}>{copy.settings.calendarFeedIntro}</p>
      <p className="mt-1 text-xs text-muted-foreground">{copy.settings.calendarFeedPrivacy}</p>

      {status.isError ? (
        <p className="mt-3 text-xs font-medium text-need" role="alert">
          {copy.settings.calendarFeedLoadError}
        </p>
      ) : (
        <div className="mt-4 border-t border-border pt-4">
          {statusLine === "" ? null : (
            <p className="mb-3 text-xs text-muted-foreground">{statusLine}</p>
          )}

          {url === null ? null : (
            <div className="mb-4 space-y-2">
              <label
                className="block text-xs font-semibold text-foreground"
                htmlFor="calendar-feed-url"
              >
                {copy.settings.calendarFeedUrlLabel}
              </label>
              <div className="flex items-center gap-2">
                <input
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs text-foreground"
                  id="calendar-feed-url"
                  onFocus={(event) => {
                    event.currentTarget.select();
                  }}
                  readOnly
                  type="text"
                  value={url}
                />
                <Button
                  onClick={() => {
                    void copyLink();
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {copied ? (
                    <Check aria-hidden="true" size={14} />
                  ) : (
                    <Copy aria-hidden="true" size={14} />
                  )}
                  <span>
                    {copied ? copy.settings.calendarFeedCopied : copy.settings.calendarFeedCopy}
                  </span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{copy.settings.calendarFeedHowTo}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {enabled ? copy.settings.calendarFeedRotate : copy.settings.calendarFeedTurnOn}
              </p>
              <p className="text-xs text-muted-foreground">
                {enabled ? copy.settings.calendarFeedRotateDetail : copy.settings.calendarFeedOff}
              </p>
            </div>
            <Button
              ariaBusy={issue.isPending}
              disabled={busy}
              onClick={turnOnOrRotate}
              size="sm"
              variant="secondary"
            >
              {turnOnLabel}
            </Button>
          </div>

          {enabled ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {copy.settings.calendarFeedRevoke}
                </p>
                <p className="text-xs text-muted-foreground">
                  {copy.settings.calendarFeedRevokeDetail}
                </p>
              </div>
              <Button
                ariaBusy={revoke.isPending}
                disabled={busy}
                onClick={turnOff}
                size="sm"
                variant="destructive"
              >
                {revoke.isPending
                  ? copy.settings.calendarFeedPending
                  : copy.settings.calendarFeedRevoke}
              </Button>
            </div>
          ) : null}

          {saveFailed ? (
            <p className="mt-3 text-xs font-medium text-need" role="alert">
              {copy.settings.calendarFeedSaveError}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
