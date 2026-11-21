import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer } from "../lib/ready-api.ts";

function sourceOf(answer: ReadyAnswer) {
  if (answer.source === "open_text") {
    return { label: copy.ready.source.review, tone: "review" as const };
  }

  if (answer.source === "derived") {
    return { label: copy.ready.source.resume, tone: "resume" as const };
  }

  if (answer.source === "fact" && answer.factSource === "resume") {
    return { label: copy.ready.source.resume, tone: "resume" as const };
  }

  return { label: copy.ready.source.fact, tone: "fact" as const };
}

const TONES = {
  fact: "bg-muted text-foreground",
  resume: "bg-ok-soft text-ok",
  review: "bg-signal-soft text-signal-text",
} as const;

export function ReadySourceTag({ answer }: { answer: ReadyAnswer }) {
  const source = sourceOf(answer);

  return (
    <span
      className={`inline-flex min-h-[22px] items-center whitespace-nowrap rounded-[4px] px-2 py-px text-[11px] font-semibold leading-normal tracking-[0.02em] ${TONES[source.tone]}`}
    >
      {source.label}
    </span>
  );
}
