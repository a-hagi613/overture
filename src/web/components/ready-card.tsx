import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer, ReadyCard as ReadyCardData } from "../lib/ready-api.ts";
import { initialsOf } from "../lib/identity.ts";
import { ReadySourceTag } from "./ready-source-tag.tsx";

function timeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.ready.dateLocale, {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(at));
}

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
  onUnapprove: (card: ReadyCardData) => void;
  saving: boolean;
  timeZone: string;
}) {
  const { card, editing, expanded, saving, timeZone } = props;
  const { plan } = card;
  const approved = card.status === "approved";
  const answers = plan?.answers.filter((answer) => !answer.coverLetter) ?? [];
  const [draft, setDraft] = useState("");

  const startEdit = (answer: ReadyAnswer) => {
    setDraft(answer.answer ?? answer.sentences.join(" "));
    props.onEdit(answer);
  };

  return (
    <article
      aria-labelledby={`ready-${card.id}`}
      className={`rounded-lg border bg-card px-[22px] pb-[18px] pt-5 shadow-sh ${
        approved ? "border-ok" : "border-border"
      }`}
      id={`card-${card.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <div className="flex min-w-0 flex-[1_1_260px] items-start gap-3.5">
          <span
            aria-hidden="true"
            className="serif flex h-10 w-10 flex-none items-center justify-center rounded-md bg-foreground text-[19px] italic text-background"
          >
            {initialsOf(card.company)}
          </span>
          <div className="min-w-0">
            <h2 className="serif text-[24px] leading-[1.1]" id={`ready-${card.id}`}>
              {card.company}
            </h2>
            <p className="mt-[3px] text-[14px] font-semibold leading-[1.5]">
              {card.title ?? plan?.postingTitle}
            </p>
            {card.location === null ? null : (
              <p className="text-[12.5px] text-muted-foreground">{card.location}</p>
            )}
          </div>
        </div>
        <div className="flex-none text-right">
          <p className="serif num text-[34px] leading-none">{card.score ?? "—"}</p>
          <p className="text-[11px] text-muted-foreground">{copy.board.matchLabel.toLowerCase()}</p>
        </div>
      </div>

      {card.changes.length === 0 ? null : (
        <div className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-[12.5px]">
          <span className="font-semibold">{copy.ready.changesTitle}</span>
          {`: ${card.changes.join(". ")}.`}
        </div>
      )}

      {plan === null ? (
        <p className="mt-3 text-[13px] text-muted-foreground">{copy.ready.noPlan}</p>
      ) : (
        <>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 text-[12.5px] text-muted-foreground">
            {plan.resume === null ? null : (
              <span className="inline-flex min-h-[26px] items-center rounded-[4px] bg-ok-soft px-2.5 py-0.5 text-[12px] font-semibold tracking-[0.02em] text-ok">
                {copy.ready.resume(plan.resume.filename)}
              </span>
            )}
            <span className="num">{copy.ready.answers(answers.length)}</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {approved ? (
              <output className="text-[13.5px] font-semibold text-ok">
                {card.sendAt === null
                  ? copy.ready.approvedNoSlot
                  : copy.ready.sendingAround(timeText(card.sendAt, timeZone))}
              </output>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    props.onApprove(card);
                  }}
                  type="button"
                >
                  {copy.ready.send}
                </button>
                <button
                  className="btn2"
                  onClick={() => {
                    props.onSkip(card);
                  }}
                  type="button"
                >
                  {copy.ready.skip}
                </button>
              </>
            )}
            {approved ? (
              <button
                className="btn2"
                onClick={() => {
                  props.onUnapprove(card);
                }}
                type="button"
              >
                {copy.ready.undo}
              </button>
            ) : (
              <button
                aria-controls={`ready-answers-${card.id}`}
                aria-expanded={expanded}
                aria-label={expanded ? undefined : copy.ready.showAnswersAria(card.company)}
                className="ml-auto min-h-8 py-1.5 text-[12.5px] font-semibold text-foreground underline underline-offset-[3px]"
                onClick={props.onToggle}
                type="button"
              >
                {expanded ? copy.ready.hideAnswers : copy.ready.showAnswers}
              </button>
            )}
          </div>

          {approved || !expanded ? null : (
            <div className="mt-3 border-t border-border" id={`ready-answers-${card.id}`}>
              {answers.map((answer) => {
                const isEditing = editing?.questionId === answer.questionId;
                const freeText = answer.kind === "open_text";

                return (
                  <div
                    className="grid grid-cols-1 items-start gap-x-3.5 gap-y-1.5 border-t border-border py-3.5 md:grid-cols-[minmax(0,1fr)_auto]"
                    key={answer.questionId}
                  >
                    <p className="text-[13px] font-semibold text-muted-foreground">
                      {answer.label}
                    </p>
                    <p className="whitespace-pre-line text-[14px] leading-[1.5] md:col-start-1">
                      {answer.answer ?? answer.sentences.join(" ")}
                    </p>
                    <div className="col-span-1 row-auto flex w-full items-center justify-between gap-1.5 md:col-start-2 md:row-span-2 md:row-start-1 md:w-auto md:flex-col md:items-end">
                      <ReadySourceTag answer={answer} />
                      {isEditing ? null : (
                        <button
                          aria-label={copy.ready.editAria(answer.label)}
                          className="min-h-8 px-0 py-1.5 text-[12.5px] font-semibold text-foreground underline underline-offset-[3px] max-[767px]:min-h-11"
                          onClick={() => {
                            startEdit(answer);
                          }}
                          type="button"
                        >
                          {copy.ready.edit}
                        </button>
                      )}
                    </div>
                    {isEditing ? (
                      <form
                        className="col-span-full mt-1 flex flex-col gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          props.onSave({ answer, value: draft });
                        }}
                      >
                        {freeText ? (
                          <textarea
                            aria-label={copy.ready.editLabel(answer.label)}
                            className="min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-[13.5px]"
                            onChange={(event) => {
                              setDraft(event.target.value);
                            }}
                            value={draft}
                          />
                        ) : (
                          <input
                            aria-label={copy.ready.editLabel(answer.label)}
                            className="h-10 w-full rounded-md border border-input bg-card px-3 text-[13.5px]"
                            onChange={(event) => {
                              setDraft(event.target.value);
                            }}
                            value={draft}
                          />
                        )}
                        <div className="flex gap-2">
                          <button className="btn" disabled={saving} type="submit">
                            {saving ? copy.ready.saving : copy.ready.save}
                          </button>
                          <button className="btn2" onClick={props.onCancelEdit} type="button">
                            {copy.ready.cancel}
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                );
              })}

              {plan.coverLetter === null || plan.coverLetter.length === 0 ? null : (
                <div className="mt-1.5 border-t border-border pt-4">
                  <p className="mb-2.5 text-[11px] font-semibold uppercase leading-[13px] tracking-[0.15em] text-muted-foreground">
                    {copy.ready.coverLetter}
                  </p>
                  <div className="rounded-md bg-muted px-4 py-3.5 text-[13.5px] leading-[1.6]">
                    <p>{plan.coverLetter.join(" ")}</p>
                  </div>
                  <p className="mt-2.5 flex items-start gap-2 text-[12.5px] text-muted-foreground">
                    <svg
                      aria-hidden="true"
                      className="mt-0.5 flex-none"
                      fill="none"
                      height="15"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="1.8"
                      viewBox="0 0 24 24"
                      width="15"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 11v5M12 8h.01" />
                    </svg>
                    {copy.ready.formChangedNote}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}
