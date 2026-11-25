import { FileText, Pencil } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer } from "../lib/ready-api.ts";
import { ReadyAnswerEditor } from "./ready-answer-editor.tsx";
import { ReadySourceTag } from "./ready-source-tag.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsEyebrow } from "./ui/ds.ts";

function answerText(answer: ReadyAnswer) {
  return answer.answer ?? answer.sentences.join(" ");
}

/**
 * Two-column always-visible grid of prepared factual answers and the attached resume, with a
 * bottom-right overflow toggle when the item count exceeds the compact viewport budget.
 * @param props Grid items, inline edit state, and overflow toggle callbacks.
 * @param props.compactLimit Maximum number of items displayed before collapsing extras.
 * @param props.draft Controlled inline edit draft string.
 * @param props.editing Question identifier currently open for editing, or `null`.
 * @param props.expanded Whether overflow items are currently expanded.
 * @param props.onCancel Invoked when editing is cancelled.
 * @param props.onChange Invoked when the edit draft changes.
 * @param props.onSave Invoked when an inline edit is submitted.
 * @param props.onStartEdit Invoked to start editing a prepared answer.
 * @param props.onToggle Invoked when the user clicks "Show more" / "Show less".
 * @param props.resumeFilename Filename of the attached resume, or `null`.
 * @param props.saved Ordered list of factual saved answers.
 * @param props.saving Whether an answer update request is currently in flight.
 * @returns Always-visible saved answers and resume grid.
 */
export function ReadySavedGrid({
  compactLimit,
  draft,
  editing,
  expanded,
  onCancel,
  onChange,
  onSave,
  onStartEdit,
  onToggle,
  resumeFilename,
  saved,
  saving,
}: {
  compactLimit: number;
  draft: string;
  editing: { questionId: string } | null;
  expanded: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: (answer: ReadyAnswer) => void;
  onStartEdit: (answer: ReadyAnswer) => void;
  onToggle: () => void;
  resumeFilename: string | null;
  saved: readonly ReadyAnswer[];
  saving: boolean;
}) {
  const totalCount = saved.length + (resumeFilename === null ? 0 : 1);

  const editedSavedIndex =
    editing === null ? -1 : saved.findIndex((item) => item.questionId === editing.questionId);

  const editingOverflow = editedSavedIndex >= compactLimit;
  const showAll = expanded || editingOverflow;
  const hasOverflow = totalCount > compactLimit;
  const hiddenCount = totalCount - compactLimit;
  const savedCap = showAll ? saved.length : compactLimit;
  const visibleSaved = saved.slice(0, savedCap);
  const showResume = resumeFilename !== null && (showAll || visibleSaved.length < compactLimit);

  return (
    <div>
      <p className={dsEyebrow}>{copy.ready.savedTitle}</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visibleSaved.map((answer) => {
          const isEditing = editing?.questionId === answer.questionId;

          return (
            <div
              className={`rounded-md border border-border bg-muted/25 px-3 py-2.5 ${isEditing ? "sm:col-span-2" : ""}`}
              key={answer.questionId}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={`${dsEyebrow} min-w-0 truncate`}>{answer.label}</p>
                {isEditing ? null : (
                  <Button
                    ariaLabel={copy.ready.editAria(answer.label)}
                    onClick={() => {
                      onStartEdit(answer);
                    }}
                    size="xs"
                    variant="ghost"
                  >
                    <Pencil aria-hidden="true" size={12} />
                    <span className="sr-only">{copy.ready.edit}</span>
                  </Button>
                )}
              </div>
              <p className="mt-0.5 break-words text-sm text-foreground">{answerText(answer)}</p>
              <div className="mt-1.5">
                <ReadySourceTag answer={answer} />
              </div>
              {isEditing ? (
                <ReadyAnswerEditor
                  answer={answer}
                  draft={draft}
                  onCancel={onCancel}
                  onChange={onChange}
                  onSubmit={() => {
                    onSave(answer);
                  }}
                  saving={saving}
                />
              ) : null}
            </div>
          );
        })}

        {showResume ? (
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className={dsEyebrow}>{copy.ready.resumeFile}</p>
              <Badge variant="ok">{copy.ready.source.resume}</Badge>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-medium text-foreground">{resumeFilename}</p>
            </div>
          </div>
        ) : null}
      </div>

      {hasOverflow ? (
        <div className="mt-2 flex justify-end">
          <Button onClick={onToggle} size="xs" variant="ghost">
            {showAll ? copy.ready.showLess : copy.ready.showMore(hiddenCount)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
