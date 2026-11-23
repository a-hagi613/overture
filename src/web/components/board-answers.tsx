import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail, SnapshotAnswer } from "../lib/board-api.ts";
import { SourceChip } from "./source-chip.tsx";
import { dsEyebrow } from "./ui/ds.ts";

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

  if (snapshot.answers.length === 0) {
    return <p className="pt-5 text-sm text-muted-foreground">{copy.board.answers.empty}</p>;
  }

  return (
    <ul aria-label={copy.board.tabs.answers} className="list-none pt-5" role="tabpanel">
      {snapshot.answers.map((answer) => {
        const source = answerSource(answer);

        return (
          <li
            className="border-b border-border py-3.5 first:pt-0 last:border-0"
            key={answer.question_id}
          >
            <p className={dsEyebrow}>{answer.label}</p>
            <p className="mt-1 font-serif text-card-title leading-snug text-foreground">
              {answer.answer ?? "—"}
            </p>
            <div className="mt-2">
              <SourceChip variant={source.variant}>{source.label}</SourceChip>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
