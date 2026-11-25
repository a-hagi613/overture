import { ArrowUpRight, Mail, Search, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useThreads } from "../lib/inbox-api.ts";
import { browserZone, currentTime } from "../lib/inbox-time.ts";
import { useMediaQuery } from "../lib/media-query.ts";
import { InboxThreadListRow } from "./inbox-thread-list-row.tsx";
import { InboxThreadPane } from "./inbox-thread-pane.tsx";
import { PageHeader } from "./page-header.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";
import { SegmentedControl } from "./ui/segmented-control.tsx";
import { SegmentedControlItem } from "./ui/segmented-control-item.tsx";

type FilterKey = "all" | "unread";

export function InboxWorkspace({ routeThreadId }: { routeThreadId: string | null }) {
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const { data, isError, isPending, refetch } = useThreads();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const threads = data?.threads ?? [];
  const counts = data?.counts ?? { all: 0, needsChecking: 0, unread: 0 };
  const needle = query.trim().toLowerCase();

  const rows = threads.filter((row) => {
    if (filter === "unread" && !row.unread) {
      return false;
    }

    if (needle === "") {
      return true;
    }

    return (
      row.company.toLowerCase().includes(needle) ||
      row.subject.toLowerCase().includes(needle) ||
      row.snippet.toLowerCase().includes(needle)
    );
  });

  const activeThreadId = routeThreadId ?? (isDesktop ? (rows[0]?.id ?? null) : null);
  const showListPane = isDesktop || routeThreadId === null;
  const showReaderPane = isDesktop || routeThreadId !== null;
  const now = currentTime();
  const zone = browserZone();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/profile/account#email-forwarding">
              <span>{copy.inbox.addressHowLink}</span>
              <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
          </Button>
        }
        titleNode={copy.inbox.titlePlain}
      />

      {isPending ? (
        <Card className="mt-4 p-6">
          <div className="space-y-3">
            <div className="h-5 w-1/3 rounded bg-muted" />
            <div className="h-16 w-full rounded bg-muted" />
            <div className="h-16 w-full rounded bg-muted" />
          </div>
        </Card>
      ) : null}

      {isError ? (
        <Card className="mt-4 flex flex-wrap items-center justify-between gap-4 p-6">
          <p className="text-sm font-semibold text-foreground" role="alert">
            {copy.inbox.loadFailed}
          </p>
          <Button
            onClick={() => {
              void refetch();
            }}
            size="sm"
            variant="outline"
          >
            {copy.inbox.retry}
          </Button>
        </Card>
      ) : null}

      {!isPending && !isError && counts.all === 0 ? (
        <Card className="mt-4 flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Mail aria-hidden="true" className="text-signal-text" size={28} />
          <h2 className={dsCardTitle}>
            {`${copy.inbox.emptyTitlePlain}${copy.inbox.emptyTitleItalic}`}
          </h2>
          <p className={`${dsBody} max-w-md`}>{copy.inbox.emptyBody}</p>
          <Button asChild className="mt-2" size="default" variant="primary">
            <Link to="/profile/account#email-forwarding">{copy.inbox.emptyPrimary}</Link>
          </Button>
        </Card>
      ) : null}

      {!isPending && !isError && counts.all > 0 ? (
        <Card
          className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
          variant="default"
        >
          {showListPane ? (
            <aside
              aria-label={copy.nav.inbox}
              className="flex min-h-0 flex-col border-border bg-muted/30 lg:w-96 lg:shrink-0 lg:border-r"
            >
              <div className="shrink-0 space-y-2.5 border-b border-border p-3">
                <SegmentedControl
                  ariaLabel={copy.inbox.filterLabel}
                  className="grid w-full grid-cols-2"
                  onValueChange={(value) => {
                    if (value === "all" || value === "unread") {
                      setFilter(value);
                    }
                  }}
                  value={filter}
                >
                  <SegmentedControlItem value="all">{`${copy.inbox.filterAll} (${String(counts.all)})`}</SegmentedControlItem>
                  <SegmentedControlItem value="unread">{`${copy.inbox.filterUnread} (${String(counts.unread)})`}</SegmentedControlItem>
                </SegmentedControl>

                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={15}
                  />
                  <Input
                    ariaLabel={copy.inbox.searchPlaceholder}
                    className="h-9 bg-card pl-9 pr-8 text-xs"
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    placeholder={copy.inbox.searchPlaceholder}
                    type="search"
                    value={query}
                  />
                  {query === "" ? null : (
                    <button
                      aria-label={copy.inbox.clearSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                      onClick={() => {
                        setQuery("");
                      }}
                      type="button"
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="relative min-h-0 flex-1">
                <div
                  className="divide-y divide-border lg:absolute lg:inset-0 lg:overflow-y-auto"
                  data-scroll-region
                >
                  {rows.length === 0 ? (
                    <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                      {copy.inbox.noMatch}
                    </p>
                  ) : (
                    rows.map((row) => (
                      <InboxThreadListRow
                        key={row.id}
                        now={now}
                        onSelect={(id) => {
                          void navigate(`/inbox/${id}`);
                        }}
                        row={row}
                        selected={row.id === activeThreadId}
                        zone={zone}
                      />
                    ))
                  )}
                </div>
              </div>
            </aside>
          ) : null}

          {showReaderPane ? (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
              <InboxThreadPane
                now={now}
                onBack={() => {
                  void navigate("/inbox");
                }}
                threadId={activeThreadId}
                zone={zone}
              />
            </section>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
