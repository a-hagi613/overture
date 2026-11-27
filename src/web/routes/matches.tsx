import { Link, useSearchParams } from "react-router";

import { copy } from "../../shared/copy.ts";
import { bandLabelOf, scoreLabelOf, useMatches } from "../lib/matches-api.ts";
import type { MatchRow } from "../lib/matches-api.ts";
import { MatchesPager } from "../components/matches-pager.tsx";
import { MatchAction } from "../components/matches-action.tsx";
import { MatchReasons } from "../components/matches-reasons.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { PanelHeader } from "../components/ui/panel-header.tsx";
import { Table } from "../components/ui/table.tsx";
import type { TableColumn } from "../components/ui/table.tsx";

const postedFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function postedLabel(postedAt: number | null) {
  return postedAt === null ? copy.matches.postedUnknown : postedFormat.format(new Date(postedAt));
}

function pageFrom(search: string) {
  const parsed = Math.trunc(Number(new URLSearchParams(search).get("page") ?? "1"));

  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
}

function stateOf(pending: boolean, failed: boolean, count: number) {
  if (pending) {
    return "loading";
  }

  if (failed) {
    return "error";
  }

  return count === 0 ? "empty" : "ready";
}

function matchesColumns() {
  const list: TableColumn<MatchRow>[] = [
    {
      header: copy.matches.columns.job,
      isPrimary: true,
      key: "job",
      render: (row) => (
        <span className="line-clamp-2 text-sm font-semibold text-foreground">{row.title}</span>
      ),
      sortValue: (row) => row.title,
    },
    {
      header: copy.matches.columns.employer,
      key: "employer",
      render: (row) => <span className="text-sm text-foreground">{row.company}</span>,
      sortValue: (row) => row.company,
    },
    {
      header: copy.matches.columns.location,
      key: "location",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.location ?? copy.matches.locationUnknown}
        </span>
      ),
      sortValue: (row) => row.location,
    },
    {
      align: "end",
      header: copy.matches.columns.score,
      headerClassName: "whitespace-nowrap",
      key: "score",
      render: (row) => (
        <span className="inline-flex flex-col items-end gap-1">
          <Badge className="tabular-nums" variant={row.score === null ? "outline" : "signal"}>
            {scoreLabelOf(row.score)}
          </Badge>
          {row.band === null ? null : (
            <span className="text-xs text-muted-foreground">{bandLabelOf(row.band)}</span>
          )}
        </span>
      ),
      sortValue: (row) => row.score,
    },
    {
      header: copy.matches.columns.reasons,
      key: "reasons",
      render: (row) => <MatchReasons row={row} />,
    },
    {
      header: copy.matches.columns.posted,
      key: "posted",
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {postedLabel(row.postedAt)}
        </span>
      ),
      sortValue: (row) => row.postedAt,
    },
    {
      align: "end",
      header: copy.matches.columns.action,
      key: "action",
      render: (row) => <MatchAction row={row} />,
    },
  ];

  return list;
}

/**
 * The Matches page: every stored score in one server-paged table, highest first, with the reasons
 * behind each score and one action per row. A job with no AI score yet says "Scoring…".
 *
 * @returns The Matches page.
 */
export function MatchesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams.toString());
  const { data, isError, isPending, refetch } = useMatches(page);

  const rows = data?.items ?? [];
  const state = stateOf(isPending, isError, rows.length);

  const changePage = (next: number) => {
    const params = new URLSearchParams(searchParams);

    if (next <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(next));
    }

    setSearchParams(params);
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader lead={copy.matches.lead} titleNode={copy.matches.title} />

      <Card ariaLabelledBy="matches-list" className="mt-3 overflow-hidden">
        <PanelHeader
          badge={
            data === undefined ? undefined : (
              <Badge className="tabular-nums" variant="secondary">
                {copy.matches.count(data.total)}
              </Badge>
            )
          }
          subtitle={copy.matches.subtitle}
          title={copy.matches.listTitle}
          titleId="matches-list"
        />

        <Table
          columns={matchesColumns()}
          empty={{
            action: (
              <Button asChild size="sm" variant="primary">
                <Link to="/profile/preferences">{copy.matches.emptyAction}</Link>
              </Button>
            ),
            description: copy.matches.emptyBody,
            title: copy.matches.emptyTitle,
          }}
          error={
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm font-semibold text-foreground">{copy.matches.error}</p>
              <Button
                onClick={() => {
                  void refetch();
                }}
                size="sm"
                variant="outline"
              >
                {copy.matches.retry}
              </Button>
            </div>
          }
          footer={
            <MatchesPager
              onChange={changePage}
              page={data?.page ?? page}
              totalPages={data?.totalPages ?? 1}
            />
          }
          initialSort={{ direction: "descending", key: "score" }}
          label={copy.matches.title}
          loadingLabel={copy.matches.loading}
          rowKey={(row) => row.id}
          rows={rows}
          state={state}
        />
      </Card>
    </div>
  );
}
