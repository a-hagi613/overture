import { Info, Pencil } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer } from "../lib/ready-api.ts";
import { ReadySourceTag } from "./ready-source-tag.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";
import { Separator } from "./ui/separator.tsx";

export function ReadyAnswersPanel({
  answers,
  cardId,
  coverLetter,
  editing,
  onCancelEdit,
  onEdit,
  onSave,
  saving,
}: {
  answers: readonly ReadyAnswer[];
  cardId: string;
  coverLetter: readonly string[] | null;
  editing: { questionId: string } | null;
  onCancelEdit: () => void;
  onEdit: (answer: ReadyAnswer) => void;
  onSave: (input: { answer: ReadyAnswer; value: string }) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState("");

  const startEdit = (answer: ReadyAnswer) => {
    setDraft(answer.answer ?? answer.sentences.join(" "));
    onEdit(answer);
  };

  return (
    <div className="mt-4 border-t border-border pt-4" id={`ready-answers-${cardId}`}>
      <div className="divide-y divide-border">
        {answers.map((answer) => {
          const isEditing = editing?.questionId === answer.questionId;
          const freeText = answer.kind === "open_text";

          return (
            <div className="py-3.5 first:pt-0 last:pb-0" key={answer.questionId}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className={dsEyebrow}>{answer.label}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {answer.answer ?? answer.sentences.join(" ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
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

              {isEditing ? (
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
                      className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
              ) : null}
            </div>
          );
        })}
      </div>

      {coverLetter === null || coverLetter.length === 0 ? null : (
        <>
          <Separator className="my-4" />
          <p className={dsEyebrow}>{copy.ready.coverLetter}</p>
          <Card className="mt-2.5 p-4" variant="muted">
            <p className="text-sm leading-relaxed text-foreground">{coverLetter.join(" ")}</p>
          </Card>
          <p className="mt-2.5 flex items-start gap-2 text-xs text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
            <span>{copy.ready.formChangedNote}</span>
          </p>
        </>
      )}
    </div>
  );
}
