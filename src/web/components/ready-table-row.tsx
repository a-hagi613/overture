import { Check, X } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ReadyCard } from "../lib/ready-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsMono } from "./ui/ds.ts";

/**
 * Single row inside the Ready approval table showing role/employer, Ember match score, prepared
 * answer summary, and direct Inspect / Approve / Skip controls.
 * @param props Row state, application payload, and action handlers.
 * @param props.active Whether this row is currently open in the inspection drawer.
 * @param props.card Ready application payload.
 * @param props.onApprove Invoked when Approve is clicked inline.
 * @param props.onInspect Invoked when the row summary or Inspect button is clicked.
 * @param props.onSkip Invoked when Skip is clicked inline.
 * @returns Approval table row element.
 */
export function ReadyTableRow({
  active,
  card,
  onApprove,
  onInspect,
  onSkip,
}: {
  active: boolean;
  card: ReadyCard;
  onApprove: (card: ReadyCard) => void;
  onInspect: (card: ReadyCard) => void;
  onSkip: (card: ReadyCard) => void;
}) {
  const { plan } = card;
  const roleTitle = card.title ?? plan?.postingTitle ?? card.company;
  const companyLine = card.location === null ? card.company : `${card.company} · ${card.location}`;

  let statusVariant: "ok" | "secondary" | null = null;
  let statusLabel: string | null = null;

  if (plan?.hasGeneratedProse === true) {
    statusVariant = "secondary";
    statusLabel = copy.ready.newProseBadge;
  } else if (plan !== null) {
    statusVariant = "ok";
    statusLabel = copy.ready.savedOnlyBadge;
  }

  return (
    <article
      className={`flex flex-col gap-2.5 px-4 py-3 transition sm:px-5 lg:flex-row lg:items-center lg:gap-4 ${
        active ? "bg-muted/50" : "hover:bg-muted/30"
      }`}
    >
      <div className="min-w-0 lg:flex-1">
        <button
          className="flex min-w-0 w-full cursor-pointer items-center gap-3 rounded-md text-left max-md:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          onClick={() => {
            onInspect(card);
          }}
          type="button"
        >
          <CompanyAvatar company={card.company} logoUrl={card.logoUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{roleTitle}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{companyLine}</p>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-2 lg:w-24 lg:shrink-0 xl:w-28">
        {card.score === null ? null : (
          <Badge className="tabular-nums" variant="signal">
            {copy.board.matchPercent(card.score)}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 lg:w-44 lg:shrink-0 lg:flex-col lg:items-start lg:gap-1 xl:w-48">
        {statusVariant !== null && statusLabel !== null ? (
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        ) : null}
        {plan === null ? (
          <span className="text-xs text-muted-foreground">{copy.ready.noPlan}</span>
        ) : (
          <span className={dsMono}>
            {copy.ready.table.answersCount(plan.answers.length, plan.resume !== null)}
          </span>
        )}
        {card.changes.length === 0 ? null : <Badge variant="need">{copy.ready.changesTitle}</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 lg:w-60 lg:shrink-0 lg:flex-nowrap lg:justify-end">
        <Button
          ariaLabel={copy.ready.table.inspectAria(card.company)}
          onClick={() => {
            onInspect(card);
          }}
          size="xs"
          variant="outline"
        >
          {copy.ready.table.inspect}
        </Button>
        {plan === null ? null : (
          <Button
            onClick={() => {
              onApprove(card);
            }}
            size="xs"
            variant="primary"
          >
            <Check aria-hidden="true" size={13} />
            <span>{copy.ready.approve}</span>
          </Button>
        )}
        <Button
          onClick={() => {
            onSkip(card);
          }}
          size="xs"
          variant="ghost"
        >
          <X aria-hidden="true" size={13} />
          <span>{copy.ready.skip}</span>
        </Button>
      </div>
    </article>
  );
}
