import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail, TimelineEvent } from "../lib/board-api.ts";
import { stamp, stageLabel } from "../lib/board-format.ts";

function statusTitle(value: string) {
  switch (value) {
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
  body: string | null;
  key: string;
  short: string | null;
  title: string;
}

function eventItems(event: TimelineEvent) {
  if (event.kind === "status" && event.toValue !== null) {
    const title = statusTitle(event.toValue);

    return title === null
      ? []
      : [{ at: event.at, body: event.detail, key: event.id, short: event.detail, title }];
  }

  if (event.kind === "stage" && event.toValue !== null) {
    const stage = stageLabel(event.toValue);

    return stage === null
      ? []
      : [
          {
            at: event.at,
            body: event.detail,
            key: event.id,
            short: event.detail,
            title: copy.board.timeline.moved(stage),
          },
        ];
  }

  if (event.kind === "email") {
    return [
      {
        at: event.at,
        body: event.detail,
        key: event.id,
        short: event.detail,
        title: copy.board.timeline.email,
      },
    ];
  }

  if (event.kind === "checkin") {
    return [
      {
        at: event.at,
        body: event.detail,
        key: event.id,
        short: event.detail,
        title: copy.board.timeline.checkin,
      },
    ];
  }

  return [
    {
      at: event.at,
      body: event.detail,
      key: event.id,
      short: event.detail,
      title: copy.board.timeline.note,
    },
  ];
}

function itemsFor(detail: ApplicationDetail) {
  const items: TimelineItem[] = [
    {
      at: detail.application.createdAt,
      body: copy.board.timeline.foundBody(detail.company),
      key: "found",
      short: null,
      title: copy.board.timeline.found,
    },
  ];

  const score = detail.match?.score ?? null;

  if (score !== null) {
    items.push({
      at: detail.application.createdAt + 60_000,
      body: detail.match?.reason ?? null,
      key: "scored",
      short: (detail.match?.reason ?? "").split(". ").at(0) ?? null,
      title: copy.board.timeline.scored(score),
    });
  }

  for (const event of detail.timeline) {
    items.push(...eventItems(event));
  }

  return items.toSorted((left, right) => left.at - right.at);
}

export function BoardTimeline({ detail }: { detail: ApplicationDetail }) {
  const items = itemsFor(detail);

  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">{copy.board.timeline.empty}</p>;
  }

  return (
    <div aria-label={copy.board.tabs.timeline} role="tabpanel">
      <ol className="flex list-none flex-col pt-[18px] md:pt-[22px]">
        {items.map((item, index) => {
          const accent = ACCENT_TITLES.has(item.title);
          const last = index === items.length - 1;

          return (
            <li className="flex gap-3.5 md:gap-4" key={item.key}>
              <div className="flex w-3.5 flex-none flex-col items-center">
                <span
                  className="mt-[5px] h-3 w-3 rounded-full border-2"
                  style={{
                    background: accent ? "var(--acc)" : "var(--done)",
                    borderColor: accent ? "var(--accbg)" : "var(--donering)",
                  }}
                />
                <span
                  className="mt-1 w-px flex-1 bg-input"
                  style={{ display: last ? "none" : "block" }}
                />
              </div>
              <div className="min-w-0 flex-1 pb-4 md:pb-5">
                <div className="flex items-baseline justify-between gap-2.5">
                  <h3
                    className={`serif text-[20px] leading-[1.2] md:text-[22px] ${
                      accent ? "text-signal-text" : ""
                    }`}
                  >
                    {item.title}
                  </h3>
                  <span className="mono flex-none text-[11px] text-muted-foreground md:text-[11.5px]">
                    {stamp(item.at, detail.timeZone)}
                  </span>
                </div>
                {item.body === null ? null : (
                  <p className="text-[13px] text-muted-foreground [text-wrap:pretty] md:mt-0.5">
                    <span className={item.short === null ? "" : "md:hidden"}>
                      {item.short ?? item.body}
                    </span>
                    {item.short === null ? null : (
                      <span className="hidden md:inline">{item.body}</span>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
