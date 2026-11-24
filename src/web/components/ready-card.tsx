import { MapPin, Pencil, Send, X } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer, ReadyCard as ReadyCardData } from "../lib/ready-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { ReadyAnswersPanel } from "./ready-answers-panel.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle } from "./ui/ds.ts";

export function ReadyCard(props: {
  card: ReadyCardData;
  editing: { questionId: string } | null;
  expanded: boolean;
  hasNext: boolean;
  onApprove: (card: ReadyCardData) => void;
  onCancelEdit: () => void;
  onEdit: (answer: ReadyAnswer) => void;
  onEditRecommended: (card: ReadyCardData) => void;
  onSave: (input: { answer: ReadyAnswer; value: string }) => void;
  onSkip: (card: ReadyCardData) => void;
  onToggle: () => void;
  saving: boolean;
}) {
  const { card, editing, expanded, hasNext, saving } = props;
  const { plan } = card;
  const roleTitle = card.title ?? plan?.postingTitle ?? card.company;

  return (
    <Card
      ariaLabelledBy={`ready-${card.id}`}
      className="transition hover:border-foreground/25"
      id={`card-${card.id}`}
      variant="default"
    >
      <div className="p-5 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <CompanyAvatar company={card.company} logoUrl={card.logoUrl} size="lg" tone="signal" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-signal-text">{card.company}</p>
              <h2 className={`${dsCardTitle} mt-0.5`} id={`ready-${card.id}`}>
                {roleTitle}
              </h2>
              {card.location === null ? null : (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin aria-hidden="true" className="shrink-0" size={13} />
                  <span>{card.location}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {card.score === null ? null : (
              <Badge className="tabular-nums" variant={card.score >= 80 ? "signal" : "secondary"}>
                {copy.board.matchPercent(card.score)}
              </Badge>
            )}
            {plan?.hasGeneratedProse === true ? (
              <Badge variant="signal">{copy.ready.newProseBadge}</Badge>
            ) : null}
            {plan !== null && !plan.hasGeneratedProse ? (
              <Badge variant="ok">{copy.ready.savedOnlyBadge}</Badge>
            ) : null}
          </div>
        </div>

        {card.changes.length === 0 ? null : (
          <Card className="mt-4 border-signal/25 bg-signal-soft/40 px-3.5 py-2.5 shadow-none">
            <p className="text-xs leading-relaxed text-foreground">
              <span className="font-semibold text-signal-text">{copy.ready.changesTitle}</span>
              {`: ${card.changes.join(". ")}.`}
            </p>
          </Card>
        )}

        {plan === null ? (
          <p className="mt-4 text-sm text-muted-foreground">{copy.ready.noPlan}</p>
        ) : (
          <>
            <ReadyAnswersPanel
              answers={plan.answers}
              cardId={card.id}
              company={card.company}
              editing={editing}
              expanded={expanded}
              onCancelEdit={props.onCancelEdit}
              onEdit={props.onEdit}
              onSave={props.onSave}
              onToggle={props.onToggle}
              resumeFilename={plan.resume?.filename ?? null}
              saving={saving}
            />

            <div className="sticky bottom-16 z-10 -mx-5 mt-5 border-t border-border bg-card/95 px-5 pb-1 pt-3 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0 md:pb-0 md:pt-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  ariaKeyshortcuts="A"
                  className="max-md:flex-1"
                  onClick={() => {
                    props.onApprove(card);
                  }}
                  size="sm"
                  variant="primary"
                >
                  <Send aria-hidden="true" size={14} />
                  <span>{hasNext ? copy.ready.approveNext : copy.ready.approveLast}</span>
                </Button>
                <Button
                  ariaKeyshortcuts="E"
                  onClick={() => {
                    props.onEditRecommended(card);
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
                    props.onSkip(card);
                  }}
                  size="sm"
                  variant="outline"
                >
                  <X aria-hidden="true" size={14} />
                  <span>{copy.ready.skip}</span>
                </Button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {copy.ready.reassurance(plan.resume !== null)}
              </p>
              <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                {copy.ready.shortcuts}
              </p>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
