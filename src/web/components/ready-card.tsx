import { ChevronDown, ChevronUp, MapPin, Send, X } from "lucide-react";

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
  onApprove: (card: ReadyCardData) => void;
  onCancelEdit: () => void;
  onEdit: (answer: ReadyAnswer) => void;
  onSave: (input: { answer: ReadyAnswer; value: string }) => void;
  onSkip: (card: ReadyCardData) => void;
  onToggle: () => void;
  saving: boolean;
}) {
  const { card, editing, expanded, saving } = props;
  const { plan } = card;
  const answers = plan?.answers.filter((answer) => !answer.coverLetter) ?? [];
  const strongMatch = card.score !== null && card.score >= 80;
  const roleTitle = card.title ?? plan?.postingTitle ?? card.company;

  return (
    <Card
      ariaLabelledBy={`ready-${card.id}`}
      className="overflow-hidden transition hover:border-foreground/25"
      id={`card-${card.id}`}
      variant="default"
    >
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
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
              <Badge className="tabular-nums" variant={strongMatch ? "signal" : "secondary"}>
                {copy.board.matchPercent(card.score)}
              </Badge>
            )}
            {plan?.resume === null || plan?.resume === undefined ? null : (
              <Badge variant="ok">{copy.ready.resume(plan.resume.filename)}</Badge>
            )}
            {plan === null ? null : (
              <Badge className="tabular-nums" variant="outline">
                {copy.ready.answers(answers.length)}
              </Badge>
            )}
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
            <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-border pt-4">
              <Button
                onClick={() => {
                  props.onApprove(card);
                }}
                size="sm"
                variant="primary"
              >
                <Send aria-hidden="true" size={14} />
                <span>{copy.ready.sendApplication}</span>
              </Button>
              <Button
                onClick={() => {
                  props.onSkip(card);
                }}
                size="sm"
                variant="outline"
              >
                <X aria-hidden="true" size={14} />
                <span>{copy.ready.skip}</span>
              </Button>
              <Button
                ariaControls={`ready-answers-${card.id}`}
                ariaExpanded={expanded}
                ariaLabel={expanded ? undefined : copy.ready.showAnswersAria(card.company)}
                className="ml-auto text-muted-foreground hover:text-foreground"
                onClick={props.onToggle}
                size="sm"
                variant="ghost"
              >
                <span>{expanded ? copy.ready.hideAnswers : copy.ready.showAnswers}</span>
                {expanded ? (
                  <ChevronUp aria-hidden="true" size={15} />
                ) : (
                  <ChevronDown aria-hidden="true" size={15} />
                )}
              </Button>
            </div>

            {expanded ? (
              <ReadyAnswersPanel
                answers={answers}
                cardId={card.id}
                coverLetter={plan.coverLetter}
                editing={editing}
                onCancelEdit={props.onCancelEdit}
                onEdit={props.onEdit}
                onSave={props.onSave}
                saving={saving}
              />
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
