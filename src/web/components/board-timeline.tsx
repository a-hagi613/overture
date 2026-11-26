import { copy, failedReasonText } from "../../shared/copy.ts";
import type { ApplicationDetail, TimelineEvent } from "../lib/board-api.ts";
import { stageLabel, stamp, timelineReasonText } from "../lib/board-format.ts";
import { ApplyRecovery } from "./apply-recovery.tsx";
import { dsMono } from "./ui/ds.ts";

const FAILED_STATUSES = new Set<string>(["failed", "skipped"]);

function statusTitle(value: string) {
  switch (value) {
    case "approved": {
      return copy.board.timeline.approved;
    }

    case "confirming": {
      return copy.board.timeline.confirming;
    }

    case "failed": {
      return copy.board.timeline.couldNotApply;
    }

    case "needs_review": {
      return copy.board.timeline.needsReview;
    }

    case "preparing": {
      return copy.board.timeline.prepared;
    }

    case "ready": {
      return copy.board.timeline.checked;
    }

    case "sending": {
      return copy.board.timeline.submitted;
    }

    case "sent": {
      return copy.board.timeline.confirmed;
    }

    case "skipped": {
      return copy.board.timeline.skipped;
    }

    case "withdrawn": {
      return copy.board.timeline.withdrawn;
    }

    default: {
      return null;
    }
  }
}

const ACCENT_TITLES = new Set<string>([copy.board.timeline.submitted, copy.board.timeline.email]);

interface TimelineItem {
  at: number;
  attempt: string | null;
  body: string | null;
  failed: boolean;
  key: string;
  reason: string | null;
  short: string | null;
  title: string;
}

function eventItems(event: TimelineEvent, attempt: string | null) {
  const reason = timelineReasonText(event.reason);

  if (event.kind === "status" && event.toValue !== null) {
    const title = statusTitle(event.toValue);

    return title === null
      ? []
      : [
          {
            at: event.at,
            attempt,
            body: event.detail,
            failed: FAILED_STATUSES.has(event.toValue),
            key: event.id,
            reason,
            short: event.detail,
            title,
          },
        ];
  }

  if (event.kind === "stage" && event.toValue !== null) {
    const stage = stageLabel(event.toValue);

    return stage === null
      ? []
      : [
          {
            at: event.at,
            attempt,
            body: event.detail,
            failed: false,
            key: event.id,
            reason,
            short: event.detail,
            title: copy.board.timeline.moved(stage),
          },
        ];
  }

  if (event.kind === "email") {
    return [
      {
        at: event.at,
        attempt,
        body: event.detail,
        failed: false,
        key: event.id,
        reason,
        short: event.detail,
        title: copy.board.timeline.email,
      },
    ];
  }

  if (event.kind === "checkin") {
    return [
      {
        at: event.at,
        attempt,
        body: event.detail,
        failed: false,
        key: event.id,
        reason,
        short: event.detail,
        title: copy.board.timeline.checkin,
      },
    ];
  }

  return [
    {
      at: event.at,
      attempt,
      body: event.detail,
      failed: false,
      key: event.id,
      reason,
      short: event.detail,
      title: copy.board.timeline.note,
    },
  ];
}

function itemsFor(detail: ApplicationDetail) {
  const items: TimelineItem[] = [
    {
      at: detail.application.createdAt,
      attempt: null,
      body: copy.board.timeline.foundBody(detail.company),
      failed: false,
      key: "found",
      reason: null,
      short: null,
      title: copy.board.timeline.found,
    },
  ];

  const score = detail.match?.score ?? null;

  if (score !== null) {
    items.push({
      at: detail.application.createdAt + 60_000,
      attempt: null,
      body: detail.match?.reason ?? null,
      failed: false,
      key: "scored",
      reason: null,
      short: (detail.match?.reason ?? "").split(". ").at(0) ?? null,
      title: copy.board.timeline.scored(score),
    });
  }

  const attempts = new Map<string, number>();

  for (const event of detail.timeline) {
    let attempt: string | null = null;

    if (event.attemptId !== null) {
      const found = attempts.get(event.attemptId);

      if (found === undefined) {
        attempts.set(event.attemptId, attempts.size + 1);
      }

      attempt = copy.board.timeline.attempt(attempts.get(event.attemptId) ?? 1);
    }

    items.push(...eventItems(event, attempt));
  }

  return items.toSorted((left, right) => left.at - right.at);
}

export function BoardTimeline({ detail }: { detail: ApplicationDetail }) {
  const items = itemsFor(detail);

  if (items.length === 0) {
    return <p className="pt-5 text-sm text-muted-foreground">{copy.board.timeline.empty}</p>;
  }

  return (
    <div>
      <ol className="flex list-none flex-col pt-5">
        {items.map((item, index) => {
          const accent = ACCENT_TITLES.has(item.title);
          const last = index === items.length - 1;

          const failure = item.failed
            ? {
                applyUrl: detail.posting.applyUrl,
                reason:
                  failedReasonText(detail.application.statusReason) ??
                  copy.home.activity.failedDefault,
              }
            : null;

          return (
            <li className="flex gap-3.5" key={item.key}>
              <div className="flex w-3.5 flex-none flex-col items-center">
                <span
                  className={`mt-1.5 h-3 w-3 rounded-full border-2 ${
                    accent ? "border-signal-soft bg-signal" : "border-ok-soft bg-ok"
                  }`}
                />
                {last ? null : <span className="mt-1 w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 flex-1 pb-5">
                <div className="flex items-baseline justify-between gap-2.5">
                  <h3
                    className={`font-serif text-card-title leading-snug ${
                      accent ? "text-signal-text" : "text-foreground"
                    }`}
                  >
                    {item.title}
                  </h3>
                  <span className={`${dsMono} flex-none`}>{stamp(item.at, detail.timeZone)}</span>
                </div>
                {item.body === null ? null : (
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    <span className={item.short === null ? "" : "md:hidden"}>
                      {item.short ?? item.body}
                    </span>
                    {item.short === null ? null : (
                      <span className="hidden md:inline">{item.body}</span>
                    )}
                  </p>
                )}
                {item.reason === null || item.reason === item.body ? null : (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-semibold">{`${copy.board.timeline.reasonLabel}:`}</span>{" "}
                    <span>{item.reason}</span>
                  </p>
                )}
                {item.attempt === null ? null : <p className={`${dsMono} mt-1`}>{item.attempt}</p>}
                {failure === null ? null : (
                  <div className="mt-2 rounded-lg border border-need bg-need-soft px-3.5 py-3">
                    <p className="text-sm leading-relaxed text-foreground">{failure.reason}</p>
                    <ApplyRecovery applyUrl={failure.applyUrl} company={detail.company} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
