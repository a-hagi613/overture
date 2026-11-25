import { copy } from "../../shared/copy.ts";
import type { ReadyCard } from "../lib/ready-api.ts";
import { ReadyTableRow } from "./ready-table-row.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow, dsMono } from "./ui/ds.ts";

/**
 * Stripe/Ramp-style structured approval table displaying all pending Ready applications with inline
 * match badges, answer summaries, and quick Inspect / Approve / Skip row actions.
 * @param props Table state and row callbacks.
 * @param props.activeId Card currently open inside the slide-over inspection drawer, or `null`.
 * @param props.cards Ordered list of pending Ready applications.
 * @param props.onApprove Invoked when Approve is clicked on a row.
 * @param props.onInspect Invoked when the user inspects a row in the drawer.
 * @param props.onSkip Invoked when Skip is clicked on a row.
 * @returns Approval table card.
 */
export function ReadyTable({
  activeId,
  cards,
  onApprove,
  onInspect,
  onSkip,
}: {
  activeId: string | null;
  cards: readonly ReadyCard[];
  onApprove: (card: ReadyCard) => void;
  onInspect: (card: ReadyCard) => void;
  onSkip: (card: ReadyCard) => void;
}) {
  return (
    <Card
      ariaLabel={copy.ready.queueAria}
      className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
      variant="default"
    >
      <div className="hidden border-b border-border bg-sidebar/40 px-5 py-2.5 lg:flex lg:items-center lg:gap-4">
        <span className={`${dsEyebrow} lg:min-w-0 lg:flex-1`}>
          {copy.ready.table.applicationCol}
        </span>
        <span className={`${dsEyebrow} lg:w-24 lg:shrink-0 xl:w-28`}>
          {copy.ready.table.matchCol}
        </span>
        <span className={`${dsEyebrow} lg:w-44 lg:shrink-0 xl:w-48`}>
          {copy.ready.table.preparedCol}
        </span>
        <span className={`${dsEyebrow} text-right lg:w-60 lg:shrink-0`}>
          {copy.ready.table.actionsCol}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="divide-y divide-border lg:absolute lg:inset-0 lg:overflow-y-auto"
          data-scroll-region
        >
          {cards.map((card) => (
            <ReadyTableRow
              active={card.id === activeId}
              card={card}
              key={card.id}
              onApprove={onApprove}
              onInspect={onInspect}
              onSkip={onSkip}
            />
          ))}
        </div>
      </div>

      <div className="hidden shrink-0 items-center justify-between gap-3 border-t border-border bg-sidebar/30 px-5 py-2 text-xs text-muted-foreground lg:flex">
        <span>{copy.ready.table.footerHint}</span>
        <span className={dsMono}>{copy.ready.shortcuts}</span>
      </div>
    </Card>
  );
}
