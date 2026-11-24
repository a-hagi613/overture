import { ChevronRight } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import { cardBadgeFor, laneForStage } from "../lib/tracker-lanes.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsCardTitle } from "./ui/ds.ts";

const UPDATED_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

export function TrackerList({
  cards,
  onOpen,
  selectedId,
}: {
  cards: readonly BoardCard[];
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  if (cards.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
        <h2 className={dsCardTitle}>{copy.board.list.emptyTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.board.list.emptyBody}</p>
      </div>
    );
  }

  return (
    <ul
      aria-label={copy.board.list.label}
      className="mt-4 list-none overflow-hidden rounded-xl border border-border bg-card shadow-sh"
    >
      {cards.map((card) => {
        const lane = laneForStage(card.stage) ?? "applied";
        const badge = cardBadgeFor(card, lane);
        const selected = selectedId === card.id;

        return (
          <li className="border-b border-border last:border-b-0" key={card.id}>
            <button
              aria-pressed={selected}
              className={`flex min-h-11 w-full items-center gap-3 p-3.5 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                selected ? "bg-muted/70" : ""
              }`}
              data-card={card.id}
              onClick={() => {
                onOpen(card.id);
              }}
              type="button"
            >
              <CompanyAvatar company={card.company} logoUrl={card.logoUrl} />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {card.company}
                </span>
                <span className="mt-0.5 block truncate font-serif text-card-title leading-snug text-foreground">
                  {card.title}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="font-semibold tabular-nums">
                    {card.score === null ? "—" : copy.board.matchPercent(card.score)}
                  </span>
                  <span className="tabular-nums">
                    {copy.board.list.updated(UPDATED_FORMAT.format(new Date(card.updatedAt)))}
                  </span>
                </span>
              </span>

              <ChevronRight
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
                size={18}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
