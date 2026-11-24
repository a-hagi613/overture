import { ChevronDown, ChevronUp, Info, Pencil } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { isDraftedProse } from "../../shared/ready-approval.ts";
import type { ReadyAnswer } from "../lib/ready-api.ts";
import { ReadySourceTag } from "./ready-source-tag.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";
import { Separator } from "./ui/separator.tsx";

function answerText(answer: ReadyAnswer) {
  return answer.answer ?? answer.sentences.join(" ");
}

export function ReadyAnswersPanel({
  answers,
  cardId,
  company,
  editing,
  expanded,
  onCancelEdit,
  onEdit,
  onSave,
  onToggle,
  resumeFilename,
  saving,
}: {
  answers: readonly ReadyAnswer[];
  cardId: string;
  company: string;
  editing: { questionId: string } | null;
  expanded: boolean;
  onCancelEdit: () => void;
  onEdit: (answer: ReadyAnswer) => void;
  onSave: (input: { answer: ReadyAnswer; value: string }) => void;
  onToggle: () => void;
  resumeFilename: string | null;
  saving: boolean;
}) {
  const [draft, setDraft] = useState("");

  const drafted = answers.filter((answer) => isDraftedProse(answer));
  const own = answers.filter((answer) => answer.source === "open_text" && answer.byUser);

  const written = [
    ...drafted.filter((answer) => !answer.coverLetter),
    ...own.filter((answer) => !answer.coverLetter),
    ...drafted.filter((answer) => answer.coverLetter),
    ...own.filter((answer) => answer.coverLetter),
  ];

  const saved = answers.filter((answer) => answer.source !== "open_text");

  const savedCount = saved.length + (resumeFilename === null ? 0 : 1);

  const startEdit = (answer: ReadyAnswer) => {
    setDraft(answerText(answer));
    onEdit(answer);
  };

  const editForm = (answer: ReadyAnswer) => {
    const freeText = answer.kind === "open_text";

    return (
      <form
        className="mt-3 flex flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ answer, value: draft });
        }}
      >
        {freeText ? (
          <textarea
            aria-label={copy.ready.editLabel(answer.label)}
            className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            value={draft}
          />
        ) : (
          <Input
            ariaLabel={copy.ready.editLabel(answer.label)}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            value={draft}
          />
        )}
        <div className="flex items-center gap-2">
          <Button disabled={saving} size="sm" submit variant="primary">
            {saving ? copy.ready.saving : copy.ready.save}
          </Button>
          <Button onClick={onCancelEdit} size="sm" variant="outline">
            {copy.ready.cancel}
          </Button>
        </div>
      </form>
    );
  };

  const answerRow = (answer: ReadyAnswer) => {
    const isEditing = editing?.questionId === answer.questionId;

    return (
      <div className="py-3.5 first:pt-0 last:pb-0" key={answer.questionId}>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className={dsEyebrow}>{answer.label}</p>
            {answer.coverLetter ? (
              <Card className="mt-2 p-4" variant="muted">
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {answerText(answer)}
                </p>
              </Card>
            ) : (
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                {answerText(answer)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ReadySourceTag answer={answer} />
            {isEditing ? null : (
              <Button
                ariaLabel={copy.ready.editAria(answer.label)}
                onClick={() => {
                  startEdit(answer);
                }}
                size="sm"
                variant="ghost"
              >
                <Pencil aria-hidden="true" size={13} />
                <span>{copy.ready.edit}</span>
              </Button>
            )}
          </div>
        </div>

        {isEditing ? editForm(answer) : null}
      </div>
    );
  };

  return (
    <div className="mt-5 border-t border-border pt-4" id={`ready-answers-${cardId}`}>
      <p className={dsEyebrow}>{copy.ready.writtenTitle}</p>

      {written.length === 0 ? null : (
        <div className="mt-1 divide-y divide-border">
          {written.map((answer) => answerRow(answer))}
        </div>
      )}

      {drafted.length === 0 ? (
        <Card className="mt-2.5 flex items-start gap-2 px-3.5 py-3" variant="muted">
          <Info aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" size={14} />
          <p className="text-xs leading-relaxed text-foreground">{copy.ready.savedOnlyNote}</p>
        </Card>
      ) : null}

      <p className="mt-2.5 flex items-start gap-2 text-xs text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
        <span>{copy.ready.formChangedNote}</span>
      </p>

      {savedCount === 0 ? null : (
        <>
          <Separator className="my-4" />
          <p className={dsEyebrow}>{copy.ready.savedTitle}</p>
          <Button
            ariaControls={`ready-saved-${cardId}`}
            ariaExpanded={expanded}
            ariaLabel={expanded ? undefined : copy.ready.showSavedAria(savedCount, company)}
            className="mt-2.5 w-full justify-between"
            onClick={onToggle}
            size="sm"
            variant="ghost"
          >
            <span>
              {expanded ? copy.ready.hideSaved(savedCount) : copy.ready.showSaved(savedCount)}
            </span>
            {expanded ? (
              <ChevronUp aria-hidden="true" size={15} />
            ) : (
              <ChevronDown aria-hidden="true" size={15} />
            )}
          </Button>

          {expanded ? (
            <div className="mt-1 divide-y divide-border" id={`ready-saved-${cardId}`}>
              {saved.map((answer) => answerRow(answer))}
              {resumeFilename === null ? null : (
                <div className="flex flex-wrap items-center justify-between gap-2 py-3.5 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className={dsEyebrow}>{copy.ready.resumeFile}</p>
                    <p className="mt-1 truncate text-sm text-foreground">{resumeFilename}</p>
                  </div>
                  <span className="text-xs font-semibold text-ok">{copy.ready.source.resume}</span>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
