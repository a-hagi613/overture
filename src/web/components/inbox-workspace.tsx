import { ArrowUpRight, Mail, Search } from "lucide-react";
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
import { Tabs } from "./ui/tabs.tsx";
import { TabsList } from "./ui/tabs-list.tsx";
import { TabsTrigger } from "./ui/tabs-trigger.tsx";

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
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          lead={copy.inbox.addressLead}
          titleNode={
            <>
              {copy.inbox.titlePlain}
              <em className="italic text-signal">{copy.inbox.titleItalic}</em>
            </>
          }
        />
        <Button asChild size="sm" variant="outline">
          <Link to="/profile/account#email-forwarding">
            <span>{copy.inbox.addressHowLink}</span>
            <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </Button>
      </div>

      {isPending ? (
        <Card className="mt-6 p-6">
          <div className="space-y-3">
            <div className="h-5 w-1/3 rounded bg-muted" />
            <div className="h-16 w-full rounded bg-muted" />
            <div className="h-16 w-full rounded bg-muted" />
          </div>
        </Card>
      ) : null}

      {isError ? (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-6">
          <p className="text-sm font-semibold text-foreground">{copy.inbox.loadFailed}</p>
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
        <Card className="mt-6 flex flex-col items-center gap-3 px-6 py-12 text-center">
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
          className="mt-6 grid min-h-[600px] grid-cols-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]"
          variant="elevated"
        >
          {showListPane ? (
            <aside
              aria-label={copy.nav.inbox}
              className="flex min-h-0 flex-col border-border bg-sidebar lg:border-r"
            >
              <div className="space-y-3 border-b border-border p-3.5">
                <Tabs
                  onValueChange={(value) => {
                    if (value === "all" || value === "unread") {
                      setFilter(value);
                    }
                  }}
                  value={filter}
                >
                  <TabsList ariaLabel={copy.inbox.filterLabel} className="grid w-full grid-cols-2">
                    <TabsTrigger value="all">{`${copy.inbox.filterAll} (${String(counts.all)})`}</TabsTrigger>
                    <TabsTrigger value="unread">{`${copy.inbox.filterUnread} (${String(counts.unread)})`}</TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={15}
                  />
                  <Input
                    ariaLabel={copy.inbox.searchPlaceholder}
                    className="h-9 bg-card pl-9 text-xs"
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    placeholder={copy.inbox.searchPlaceholder}
                    type="search"
                    value={query}
                  />
                </div>
              </div>

              <div className="flex-1 divide-y divide-border overflow-y-auto" data-scroll-region>
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
            </aside>
          ) : null}

          {showReaderPane ? (
            <section className="flex min-h-0 flex-col bg-card">
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
