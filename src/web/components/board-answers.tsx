import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail, SnapshotAnswer } from "../lib/board-api.ts";
import { kilobytes } from "../lib/board-format.ts";
import { SourceChip } from "./source-chip.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsEyebrow, dsMono } from "./ui/ds.ts";

function answerSource(answer: SnapshotAnswer) {
  if (answer.kind === "file") {
    return { label: copy.board.answers.fromResume, variant: "solid" as const };
  }

  if (answer.kind === "open_text" || answer.kind === "cover_letter") {
    return answer.resume_line_ids.length > 0
      ? { label: copy.board.answers.fromResume, variant: "solid" as const }
      : { label: copy.board.answers.typedHere, variant: "dashed" as const };
  }

  if (answer.fact_key?.startsWith("q:") === true) {
    return { label: copy.board.answers.typedHere, variant: "dashed" as const };
  }

  return { label: copy.board.answers.fromSaved, variant: "solid" as const };
}

export function BoardAnswers({ detail }: { detail: ApplicationDetail }) {
  const { snapshot } = detail;

  if (snapshot === null) {
    return <p className="pt-5 text-sm text-muted-foreground">{copy.board.answers.noSnapshot}</p>;
  }

  const answers = snapshot.answers.filter((answer) => answer.kind !== "file");

  return (
    <div className="pt-5">
      <section aria-label={copy.board.appliedWith.resumeTitle}>
        <h3 className={dsCardTitle}>{copy.board.appliedWith.resumeTitle}</h3>
        {snapshot.resume === null ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {copy.board.appliedWith.resumeMissing}
          </p>
        ) : (
          <Card className="mt-2 p-3.5" variant="muted">
            <p className="truncate font-mono text-xs font-semibold text-foreground">
              {snapshot.resume.filename}
            </p>
            <p className={`${dsMono} mt-1.5`}>
              {`${kilobytes(snapshot.resume.bytes)} · ${copy.board.dossier.fileSha} ${snapshot.resume.sha256.slice(0, 16)}…`}
            </p>
          </Card>
        )}
      </section>

      <section aria-label={copy.board.appliedWith.answersTitle} className="mt-5">
        <h3 className={dsCardTitle}>{copy.board.appliedWith.answersTitle}</h3>
        {answers.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {copy.board.appliedWith.answersMissing}
          </p>
        ) : (
          <ul className="mt-1 list-none">
            {answers.map((answer) => {
              const source = answerSource(answer);

              return (
                <li
                  className="border-b border-border py-3.5 first:pt-0 last:border-0 last:pb-0"
                  key={answer.question_id}
                >
                  <p className={dsEyebrow}>{answer.label}</p>
                  <p className="mt-1 break-words font-serif text-card-title leading-snug text-foreground">
                    {answer.answer ?? "—"}
                  </p>
                  <div className="mt-2">
                    <SourceChip variant={source.variant}>{source.label}</SourceChip>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
