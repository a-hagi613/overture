import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import type { HomeInboxRow } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { stampText } from "../lib/home-time.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsMono } from "./ui/ds.ts";

export function HomeInbox(props: { now: number; rows: readonly HomeInboxRow[]; zone: string }) {
  const { now, rows, zone } = props;

  return (
    <Card ariaLabelledBy="home-inbox" className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className={dsCardTitle} id="home-inbox">
          {copy.home.inbox.title}
        </h2>
        <Button asChild size="sm" variant="secondary">
          <Link to="/inbox">
            {copy.home.inbox.open}
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{copy.home.inbox.empty}</p>
      ) : (
        <div className="mt-4 flex flex-1 flex-col divide-y divide-border">
          {rows.map((row) => (
            <Link
              className="group -mx-2 flex flex-1 items-center justify-between gap-4 rounded-lg px-2 py-4 transition hover:bg-muted"
              key={row.id}
              to="/inbox"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-foreground">
                  <span className="font-semibold group-hover:text-signal-text">{row.company}</span>{" "}
                  {row.text}
                </p>
                {row.detail === null ? null : (
                  <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
                )}
              </div>
              <span className={`${dsMono} shrink-0`}>{stampText(row.at, now, zone)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
