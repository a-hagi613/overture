import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { scoreLabelOf, useMatches } from "../lib/matches-api.ts";
import { PageHeader } from "../components/page-header.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { PanelEmpty } from "../components/ui/panel-empty.tsx";
import { PanelHeader } from "../components/ui/panel-header.tsx";
import { PanelList } from "../components/ui/panel-list.tsx";

/**
 * The read-only Matches list Home's count opens. #690 grows this into the full Matches page
 * with picks and the job drawer; until then every row reports its stored score or "Scoring…".
 *
 * @returns The Matches page.
 */
export function MatchesPage() {
  const { data, isError, isPending, refetch } = useMatches();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader lead={copy.matches.lead} titleNode={copy.matches.title} />

      {isPending ? (
        <Card ariaBusy className="mt-3 p-4">
          <span className="sr-only">{copy.shell.loadingPage}</span>
          <div className="animate-pulse space-y-3">
            <div className="h-5 w-1/3 rounded bg-muted" />
            <div className="h-14 w-full rounded bg-muted" />
            <div className="h-14 w-full rounded bg-muted" />
          </div>
        </Card>
      ) : null}

      {isError ? (
        <Card className="mt-3 flex flex-wrap items-center justify-between gap-4 p-4">
          <p className="text-sm font-semibold text-foreground" role="alert">
            {copy.matches.error}
          </p>
          <Button
            onClick={() => {
              void refetch();
            }}
            size="sm"
            variant="outline"
          >
            {copy.matches.retry}
          </Button>
        </Card>
      ) : null}

      {data === undefined ? null : (
        <Card ariaLabelledBy="matches-list" className="mt-3 overflow-hidden">
          <PanelHeader
            badge={
              <Badge className="tabular-nums" variant="secondary">
                {copy.matches.count(data.total)}
              </Badge>
            }
            subtitle={copy.matches.subtitle}
            title={copy.matches.listTitle}
            titleId="matches-list"
          />
          {data.items.length === 0 ? (
            <PanelEmpty
              action={
                <Button asChild size="sm" variant="primary">
                  <Link to="/profile/preferences">{copy.matches.emptyAction}</Link>
                </Button>
              }
              description={copy.matches.emptyBody}
              title={copy.matches.emptyTitle}
            />
          ) : (
            <PanelList>
              {data.items.map((row) => (
                <div className="flex min-h-11 items-center justify-between gap-3 py-2" key={row.id}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {row.location === null ? row.company : `${row.company} · ${row.location}`}
                    </p>
                  </div>
                  <Badge
                    className="shrink-0 tabular-nums"
                    variant={row.score === null ? "outline" : "signal"}
                  >
                    {scoreLabelOf(row.score)}
                  </Badge>
                </div>
              ))}
            </PanelList>
          )}
        </Card>
      )}
    </div>
  );
}
