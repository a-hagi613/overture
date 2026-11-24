import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer } from "../lib/ready-api.ts";
import { Badge } from "./ui/badge.tsx";

function sourceOf(answer: ReadyAnswer) {
  if (answer.source === "open_text") {
    return answer.byUser
      ? { label: copy.ready.source.yours, variant: "secondary" as const }
      : { label: copy.ready.source.drafted, variant: "signal" as const };
  }

  if (answer.source === "derived" || (answer.source === "fact" && answer.factSource === "resume")) {
    return { label: copy.ready.source.resume, variant: "ok" as const };
  }

  return { label: copy.ready.source.saved, variant: "secondary" as const };
}

export function ReadySourceTag({ answer }: { answer: ReadyAnswer }) {
  const source = sourceOf(answer);

  return <Badge variant={source.variant}>{source.label}</Badge>;
}
