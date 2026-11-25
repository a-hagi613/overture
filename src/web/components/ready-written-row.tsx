import { Pencil } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer } from "../lib/ready-api.ts";
import { ReadyAnswerEditor } from "./ready-answer-editor.tsx";
import { ReadySourceTag } from "./ready-source-tag.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";

function answerText(answer: ReadyAnswer) {
  return answer.answer ?? answer.sentences.join(" ");
}

/**
 * Single drafted or user-written response row rendered above prepared factual answers on a Ready card.
 * @param props Written row state and editing callbacks.
 * @param props.answer Written answer or cover letter payload.
 * @param props.draft Current inline edit draft value.
 * @param props.isEditing Whether this question is currently being edited inline.
 * @param props.onCancel Invoked to cancel inline editing.
 * @param props.onChange Invoked as draft text updates.
 * @param props.onSave Invoked on inline edit submit.
 * @param props.onStartEdit Invoked to begin editing this row.
 * @param props.saving Whether a save mutation is in flight.
 * @returns Formatted written response row with source tag and optional inline editor.
 */
export function ReadyWrittenRow({
  answer,
  draft,
  isEditing,
  onCancel,
  onChange,
  onSave,
  onStartEdit,
  saving,
}: {
  answer: ReadyAnswer;
  draft: string;
  isEditing: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onStartEdit: (answer: ReadyAnswer) => void;
  saving: boolean;
}) {
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className={dsEyebrow}>{answer.label}</p>
          {answer.coverLetter ? (
            <Card className="mt-1.5 p-3" variant="muted">
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
                onStartEdit(answer);
              }}
              size="xs"
              variant="ghost"
            >
              <Pencil aria-hidden="true" size={13} />
              <span>{copy.ready.edit}</span>
            </Button>
          )}
        </div>
      </div>

      {isEditing ? (
        <ReadyAnswerEditor
          answer={answer}
          draft={draft}
          onCancel={onCancel}
          onChange={onChange}
          onSubmit={onSave}
          saving={saving}
        />
      ) : null}
    </div>
  );
}
