import { Check, ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer, ReadyCard as ReadyCardData } from "../lib/ready-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { ReadyAnswersPanel } from "./ready-answers-panel.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsMono } from "./ui/ds.ts";
import { SlideOverDrawer } from "./ui/slide-over-drawer.tsx";

/**
 * Slide-over inspection drawer for reading drafted answers, editing saved responses, stepping
 * Prev/Next across Ready rows, and approving or skipping an application.
 * @param props Drawer props wrapping active application state and callbacks.
 * @returns Slide-over inspection dialog.
 */
export function ReadyInspectDrawer(props: {
  card: ReadyCardData | null;
  count: number;
  editing: { questionId: string } | null;
  expanded: boolean;
  index: number;
  onApprove: (card: ReadyCardData) => void;
  onCancelEdit: () => void;
  onClose: () => void;
  onEdit: (answer: ReadyAnswer) => void;
  onEditRecommended: (card: ReadyCardData) => void;
  onNext: () => void;
  onPrev: () => void;
  onSave: (input: { answer: ReadyAnswer; value: string }) => void;
  onSkip: (card: ReadyCardData) => void;
  onToggle: () => void;
  saving: boolean;
}) {
  const {
    card,
    count,
    editing,
    expanded,
    index,
    onApprove,
    onCancelEdit,
    onClose,
    onEdit,
    onEditRecommended,
    onNext,
    onPrev,
    onSave,
    onSkip,
    onToggle,
    saving,
  } = props;

  if (card === null) {
    return (
      <SlideOverDrawer
        header={null}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        open={false}
        title={copy.ready.table.drawerAria}
      >
        {null}
      </SlideOverDrawer>
    );
  }

  const { plan } = card;
  const roleTitle = card.title ?? plan?.postingTitle ?? card.company;
  const companyLine = card.location === null ? card.company : `${card.company} · ${card.location}`;

  let proseBadge: "ok" | "secondary" | null = null;
  let proseLabel: string | null = null;

  if (plan?.hasGeneratedProse === true) {
    proseBadge = "secondary";
    proseLabel = copy.ready.newProseBadge;
  } else if (plan !== null) {
    proseBadge = "ok";
    proseLabel = copy.ready.savedOnlyBadge;
  }

  const header = (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={dsMono}>{copy.ready.carousel.position(index + 1, count)}</span>
          <Button
            ariaLabel={copy.ready.carousel.previousAria}
            className="h-7 w-7 max-md:h-11 max-md:w-11"
            disabled={count <= 1}
            onClick={onPrev}
            size="icon"
            variant="outline"
          >
            <ChevronLeft aria-hidden="true" size={14} />
          </Button>
          <Button
            ariaLabel={copy.ready.carousel.nextAria}
            className="h-7 w-7 max-md:h-11 max-md:w-11"
            disabled={count <= 1}
            onClick={onNext}
            size="icon"
            variant="outline"
          >
            <ChevronRight aria-hidden="true" size={14} />
          </Button>
        </div>
        <Button
          ariaLabel={copy.codePaste.close}
          className="h-8 w-8 max-md:h-11 max-md:w-11"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" size={16} />
        </Button>
      </div>

      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <CompanyAvatar company={card.company} logoUrl={card.logoUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <h2 className={dsCardTitle}>{roleTitle}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{companyLine}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {card.score === null ? null : (
            <Badge className="tabular-nums" variant="signal">
              {copy.board.matchPercent(card.score)}
            </Badge>
          )}
          {proseBadge !== null && proseLabel !== null ? (
            <Badge variant={proseBadge}>{proseLabel}</Badge>
          ) : null}
        </div>
      </div>
    </div>
  );

  const footer =
    plan === null ? undefined : (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ariaKeyshortcuts="A"
          className="max-md:flex-1"
          onClick={() => {
            onApprove(card);
          }}
          size="sm"
          variant="primary"
        >
          <Check aria-hidden="true" size={14} />
          <span>{copy.ready.approve}</span>
        </Button>
        <Button
          ariaKeyshortcuts="E"
          onClick={() => {
            onEditRecommended(card);
          }}
          size="sm"
          variant="secondary"
        >
          <Pencil aria-hidden="true" size={14} />
          <span>{copy.ready.edit}</span>
        </Button>
        <Button
          ariaKeyshortcuts="S"
          onClick={() => {
            onSkip(card);
          }}
          size="sm"
          variant="outline"
        >
          <X aria-hidden="true" size={14} />
          <span>{copy.ready.skip}</span>
        </Button>
      </div>
    );

  return (
    <SlideOverDrawer
      description={`${card.company} · ${roleTitle}`}
      footer={footer}
      header={header}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      title={copy.ready.table.drawerAria}
    >
      {card.changes.length === 0 ? null : (
        <Card className="mb-3.5 border-need/35 bg-need-soft/45 px-3.5 py-2 shadow-none">
          <p className="text-xs leading-relaxed text-foreground">
            <span className="font-semibold text-need">{copy.ready.changesTitle}</span>
            {`: ${card.changes.join(". ")}.`}
          </p>
        </Card>
      )}

      {plan === null ? (
        <p className="text-sm text-muted-foreground">{copy.ready.noPlan}</p>
      ) : (
        <ReadyAnswersPanel
          answers={plan.answers}
          cardId={card.id}
          editing={editing}
          expanded={expanded}
          onCancelEdit={onCancelEdit}
          onEdit={onEdit}
          onSave={onSave}
          onToggle={onToggle}
          resumeFilename={plan.resume?.filename ?? null}
          saving={saving}
        />
      )}
    </SlideOverDrawer>
  );
}
