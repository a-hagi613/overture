import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail, SnapshotAnswer } from "../lib/board-api.ts";
import { SourceChip } from "./source-chip.tsx";

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
    return (
      <p className="pt-[18px] text-[13px] text-muted-foreground md:pt-[22px]">
        {copy.board.answers.noSnapshot}
      </p>
    );
  }

  if (snapshot.answers.length === 0) {
    return (
      <p className="pt-[18px] text-[13px] text-muted-foreground md:pt-[22px]">
        {copy.board.answers.empty}
      </p>
    );
  }

  return (
    <ul
      aria-label={copy.board.tabs.answers}
      className="list-none pt-[18px] md:pt-[22px]"
      role="tabpanel"
    >
      {snapshot.answers.map((answer) => {
        const source = answerSource(answer);

        return (
          <li
            className="border-b border-border py-3 first:pt-0 last:border-0"
            key={answer.question_id}
          >
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {answer.label}
            </p>
            <p className="serif mt-1 text-[19px] leading-[1.3]">{answer.answer ?? "—"}</p>
            <div className="mt-1.5">
              <SourceChip variant={source.variant}>{source.label}</SourceChip>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
