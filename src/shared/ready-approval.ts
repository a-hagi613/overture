/** A dwell time is a bounded millisecond count, never an identity. */
export const READY_DWELL_MAX_MS = 86_400_000;

export interface ReadyProseAnswer {
  byUser: boolean;
  kind: string;
  source: string | null;
}

/**
 * Says whether an answer is prose Overture drafted and the user has not rewritten.
 * @param answer The plan answer to classify.
 * @returns `true` for newly drafted open text or cover letter prose.
 */
export function isDraftedProse(answer: ReadyProseAnswer) {
  return answer.kind === "open_text" && answer.source === "open_text" && !answer.byUser;
}

/**
 * Says whether any answer on the plan carries newly drafted prose, cover letter included.
 * @param answers The answers of one send plan.
 * @returns `true` when the card needs individual review before approval.
 */
export function planHasGeneratedProse(answers: readonly ReadyProseAnswer[]) {
  return answers.some((answer) => isDraftedProse(answer));
}
