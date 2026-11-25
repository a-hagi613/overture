import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { isDraftedProse } from "../../shared/ready-approval.ts";
import type { ReadyAnswer } from "../lib/ready-api.ts";
import { ReadySavedGrid } from "./ready-saved-grid.tsx";
import { ReadyWrittenRow } from "./ready-written-row.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Separator } from "./ui/separator.tsx";

function answerText(answer: ReadyAnswer) {
  return answer.answer ?? answer.sentences.join(" ");
}

/**
 * Always-visible answer breakdown for an application in the Ready preview pane, showing drafted
 * prose first (if any) followed directly by a two-column prepared answers and resume grid.
 * @param props Panel data, edit controls, and overflow toggle callbacks.
 * @param props.answers Planned application answers.
 * @param props.cardId Application card identifier.
 * @param props.editing Currently edited question target, or `null`.
 * @param props.expanded Whether overflowing saved answers are expanded.
 * @param props.onCancelEdit Invoked when inline editing is cancelled.
 * @param props.onEdit Invoked when the user opens inline editing for an answer.
 * @param props.onSave Invoked when the user submits an edited answer.
 * @param props.onToggle Invoked when the user toggles overflowing prepared answers.
 * @param props.resumeFilename Resume PDF filename, or `null`.
 * @param props.saving Whether an edit mutation is currently pending.
 * @returns Prepared answers panel.
 */
export function ReadyAnswersPanel({
  answers,
  cardId,
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
  const compactLimit = written.length > 0 ? 4 : 6;

  const startEdit = (answer: ReadyAnswer) => {
    setDraft(answerText(answer));
    onEdit(answer);
  };

  if (written.length === 0 && savedCount === 0) {
    return null;
  }

  return (
    <div id={`ready-answers-${cardId}`}>
      {written.length > 0 ? (
        <div>
          <p className={dsEyebrow}>{copy.ready.writtenTitle}</p>
          <div className="mt-1.5 divide-y divide-border">
            {written.map((answer) => (
              <ReadyWrittenRow
                answer={answer}
                draft={draft}
                isEditing={editing?.questionId === answer.questionId}
                key={answer.questionId}
                onCancel={onCancelEdit}
                onChange={setDraft}
                onSave={() => {
                  onSave({ answer, value: draft });
                }}
                onStartEdit={startEdit}
                saving={saving}
              />
            ))}
          </div>
        </div>
      ) : null}

      {savedCount === 0 ? null : (
        <div className={written.length > 0 ? "mt-3" : ""}>
          {written.length > 0 ? <Separator className="mb-3" /> : null}
          <ReadySavedGrid
            compactLimit={compactLimit}
            draft={draft}
            editing={editing}
            expanded={expanded}
            onCancel={onCancelEdit}
            onChange={setDraft}
            onSave={(answer) => {
              onSave({ answer, value: draft });
            }}
            onStartEdit={startEdit}
            onToggle={onToggle}
            resumeFilename={resumeFilename}
            saved={saved}
            saving={saving}
          />
        </div>
      )}
    </div>
  );
}
