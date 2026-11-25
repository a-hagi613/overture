import { ChevronRight } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import { cardBadgeFor, laneForStage } from "../lib/tracker-lanes.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsMono } from "./ui/ds.ts";

const UPDATED_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
const EMPTY_SCORE = "—";

/**
 * Single table-list row in Application Tracker's List view with employer/role identity, Ember
 * match badge, stage pill, updated date, and chevron.
 * @param props Row card data, selection state, and click callback.
 * @returns List item element containing an interactive card button.
 */
export function TrackerListRow(props: {
  card: BoardCard;
  onOpen: (id: string) => void;
  selected: boolean;
}) {
  const { card, onOpen, selected } = props;
  const lane = laneForStage(card.stage) ?? "applied";
  const badge = cardBadgeFor(card, lane);
  const companyLine = card.location === null ? card.company : `${card.company} · ${card.location}`;
  const updatedText = UPDATED_FORMAT.format(new Date(card.updatedAt));

  return (
    <li>
      <button
        aria-pressed={selected}
        className={`flex min-h-11 w-full flex-col gap-3 px-4 py-4 text-left transition sm:px-5 sm:py-4 lg:flex-row lg:items-center lg:gap-6 ${
          selected ? "bg-muted/60" : "hover:bg-muted/35"
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground`}
        data-card={card.id}
        onClick={() => {
          onOpen(card.id);
        }}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-3.5 lg:flex-1">
          <CompanyAvatar company={card.company} logoUrl={card.logoUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-snug text-foreground">
              {card.title}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{companyLine}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-0.5 lg:contents">
          <div className="lg:w-28 lg:shrink-0">
            {card.score === null ? (
              <span className={dsMono}>{EMPTY_SCORE}</span>
            ) : (
              <Badge className="tabular-nums" variant="signal">
                {copy.board.matchPercent(card.score)}
              </Badge>
            )}
          </div>

          <div className="lg:w-44 lg:shrink-0">
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>

          <div className="ml-auto flex items-center gap-2 lg:ml-0 lg:w-36 lg:shrink-0 lg:justify-end">
            <span className={dsMono}>{copy.board.list.updated(updatedText)}</span>
            <ChevronRight aria-hidden="true" className="shrink-0 text-muted-foreground" size={16} />
          </div>
        </div>
      </button>
    </li>
  );
}
