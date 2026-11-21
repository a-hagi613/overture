import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useThreads } from "../lib/inbox-api.ts";
import { browserZone, currentTime } from "../lib/inbox-time.ts";
import { PageHeader } from "../components/page-header.tsx";
import { InboxThreadRowView } from "../components/inbox-thread-row.tsx";

type FilterKey = "all" | "unread" | "checking";

function dateLine() {
  const now = new Date();
  const weekday = now.toLocaleDateString(copy.home.dateLocale, { weekday: "long" });
  const month = now.toLocaleDateString(copy.home.dateLocale, { month: "long" });

  return `${weekday}, ${String(now.getDate())} ${month}`;
}

export function InboxPage() {
  const { data } = useThreads();
  const [filter, setFilter] = useState<FilterKey>("all");
  const threads = data?.threads ?? [];
  const counts = data?.counts ?? { all: 0, needsChecking: 0, unread: 0 };

  const rows = threads.filter((row) => {
    if (filter === "unread") {
      return row.unread;
    }

    if (filter === "checking") {
      return row.needsChecking;
    }

    return true;
  });

  const now = currentTime();
  const zone = browserZone();

  const filters: { count: number; key: FilterKey; label: string }[] = [
    { count: counts.all, key: "all", label: copy.inbox.allCount(counts.all) },
    { count: counts.unread, key: "unread", label: copy.inbox.unreadCount(counts.unread) },
    {
      count: counts.needsChecking,
      key: "checking",
      label: copy.inbox.needsCheckingCount(counts.needsChecking),
    },
  ];

  return (
    <div>
      <PageHeader
        lead={dateLine()}
        showRunningSwitch={false}
        titleNode={
          <>
            {copy.inbox.titlePlain}
            <span className="italic">{copy.inbox.titleItalic}</span>
          </>
        }
      />
      <div className="mt-[22px] flex flex-wrap items-center justify-between gap-3">
        <fieldset
          aria-label={copy.inbox.filterLabel}
          className="m-0 inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1"
        >
          {filters.map((entry) => (
            <button
              aria-pressed={filter === entry.key}
              className={`inline-flex min-h-[34px] items-center rounded-[5px] px-[15px] text-[12.5px] font-semibold ${
                filter === entry.key
                  ? "bg-card text-foreground shadow-sh"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              key={entry.key}
              onClick={() => {
                setFilter(entry.key);
              }}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </fieldset>
        {counts.all === 0 ? null : (
          <p className="font-serif text-sm leading-[1.5] italic text-muted-foreground">
            {copy.inbox.latest}
          </p>
        )}
      </div>
      <p className="mt-1 max-w-[620px] text-[14.5px] text-muted-foreground">
        {copy.inbox.addressLead}{" "}
        <Link className="text-signal-text underline underline-offset-[3px]" to="/inbox/address">
          {copy.inbox.addressHowLink}
        </Link>
      </p>
      {counts.all === 0 ? (
        <section
          aria-labelledby="inbox-empty"
          className="mt-[18px] flex flex-col items-center gap-3.5 rounded-lg border border-border bg-card px-7 py-11 text-center shadow-sh max-md:px-4"
        >
          <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full border border-input bg-muted font-serif text-[26px] italic">
            {copy.inbox.emptyZero}
          </span>
          <h2 className="font-serif text-[32px] leading-[1.1]" id="inbox-empty">
            {copy.inbox.emptyTitlePlain}
            <span className="italic">{copy.inbox.emptyTitleItalic}</span>
          </h2>
          <p className="max-w-[460px] text-[14.5px] text-muted-foreground">
            {copy.inbox.emptyBody}
          </p>
          <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-foreground bg-foreground px-[18px] text-[13.5px] font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover max-md:min-h-11"
              to="/inbox/address"
            >
              {copy.inbox.emptyPrimary}
            </Link>
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-input bg-card px-4 text-[13.5px] font-semibold hover:bg-muted max-md:min-h-11"
              to="/inbox/address"
            >
              {copy.inbox.emptySecondary}
            </Link>
          </div>
          <p className="max-w-[460px] text-[13px] text-muted-foreground">{copy.inbox.emptyNote}</p>
        </section>
      ) : (
        <section
          aria-label={copy.nav.inbox}
          className="mt-[18px] overflow-hidden rounded-lg border border-border bg-card shadow-sh max-md:px-4"
        >
          {rows.map((row) => (
            <InboxThreadRowView key={row.id} now={now} row={row} zone={zone} />
          ))}
        </section>
      )}
    </div>
  );
}
