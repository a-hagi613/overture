import type { AttemptRow } from "../../lib/admin-api.ts";
import { ATTEMPT_TONE_CLASSES, attemptOutcomeDisplay } from "./attempts-format.ts";

export function AttemptOutcomeBadge({ attempt }: { attempt: AttemptRow }) {
  const display = attemptOutcomeDisplay(attempt.outcome);

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${ATTEMPT_TONE_CLASSES[display.tone]}`}
    >
      {display.label}
    </span>
  );
}
