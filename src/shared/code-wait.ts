export const CODE_WAIT_TIMEOUT_MS = 10 * 60_000;

export const CODE_WAIT_ASK_MS = 5 * 60_000;

/**
 * The refusal codes `POST /api/mail/code-waits/:id` returns, shared so the
 * client branches on the same spelling the server sends. `not_found` is the
 * shared missing-row code; `expired` and `already_resolved` are this route's
 * two 409 refusals (SPEC §11.1).
 */
export const CODE_WAIT_ERRORS = {
  alreadyResolved: "already_resolved",
  expired: "expired",
} as const;
