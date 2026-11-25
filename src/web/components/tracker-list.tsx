import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import { TrackerListRow } from "./tracker-list-row.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsEyebrow } from "./ui/ds.ts";

/**
 * Clean flat hairline table-list for Application Tracker's List view matching the Ready table
 * grammar while preserving semantic list markup on desktop and mobile.
 * @param props Filtered application rows, click callback, and selected id.
 * @returns Table-list card or empty state card.
 */
export function TrackerList(props: {
  cards: readonly BoardCard[];
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  const { cards, onOpen, selectedId } = props;

  if (cards.length === 0) {
    return (
      <Card className="mt-3 px-5 py-10 text-center">
        <h2 className={dsCardTitle}>{copy.board.list.emptyTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.board.list.emptyBody}</p>
      </Card>
    );
  }

  return (
    <Card className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden" variant="default">
      <div className="hidden border-b border-border bg-sidebar/40 px-5 py-3 lg:flex lg:items-center lg:gap-6">
        <span className={`${dsEyebrow} lg:min-w-0 lg:flex-1`}>
          {copy.board.list.applicationCol}
        </span>
        <span className={`${dsEyebrow} lg:w-28 lg:shrink-0`}>{copy.board.list.matchCol}</span>
        <span className={`${dsEyebrow} lg:w-44 lg:shrink-0`}>{copy.board.list.stageCol}</span>
        <span className={`${dsEyebrow} text-right lg:w-36 lg:shrink-0`}>
          {copy.board.list.updatedCol}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <ul
          aria-label={copy.board.list.label}
          className="m-0 list-none divide-y divide-border p-0 lg:absolute lg:inset-0 lg:overflow-y-auto"
          data-scroll-region
        >
          {cards.map((card) => (
            <TrackerListRow
              card={card}
              key={card.id}
              onOpen={onOpen}
              selected={selectedId === card.id}
            />
          ))}
        </ul>
      </div>
    </Card>
  );
}
