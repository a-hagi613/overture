import { ArrowUpRight, Inbox } from "lucide-react";
import { Link } from "react-router";

import type { HomeInboxRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { stampText } from "../lib/home-time.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsMono } from "./ui/ds.ts";
import { PanelEmpty } from "./ui/panel-empty.tsx";
import { PanelHeader } from "./ui/panel-header.tsx";
import { PanelList } from "./ui/panel-list.tsx";

export function HomeInbox(props: { now: number; rows: readonly HomeInboxRow[]; zone: string }) {
  const { now, rows, zone } = props;

  return (
    <Card ariaLabelledBy="home-inbox" className="flex h-full flex-col overflow-hidden">
      <PanelHeader
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/inbox">
              {copy.home.inbox.open}
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
        icon={<Inbox aria-hidden="true" className="h-4 w-4" />}
        title={copy.home.inbox.title}
        titleId="home-inbox"
      />
      {rows.length === 0 ? (
        <PanelEmpty title={copy.home.inbox.empty} />
      ) : (
        <PanelList className="flex-1">
          {rows.map((row) => (
            <Link
              className="group -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-3 transition hover:bg-muted"
              key={row.id}
              to="/inbox"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-foreground">
                  <span className="font-semibold">{row.company}</span> {row.text}
                </p>
                {row.detail === null ? null : (
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
                )}
              </div>
              <span className={`${dsMono} shrink-0`}>{stampText(row.at, now, zone)}</span>
            </Link>
          ))}
        </PanelList>
      )}
    </Card>
  );
}
