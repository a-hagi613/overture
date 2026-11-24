export const CODE_WAIT_TIMEOUT_MS = 10 * 60_000;

/**
 * How long Overture waits before asking for a paste when the dedicated address
 * has already forwarded mail, so the Email Worker can intercept the code and
 * resolve the wait without the user (#565).
 */
export const CODE_WAIT_ALIAS_GRACE_MS = 45_000;

/**
 * The wait before asking when the address has never forwarded mail: the code
 * went to the user's own inbox, so Overture cannot read it and asks at once.
 */
export const CODE_WAIT_PERSONAL_ASK_MS = 0;

/**
 * How long after a wait opened the user is asked for the code. A confirmed
 * forwarding address gets the Email Worker a 45-second head start; without one
 * the ask is immediate.
 * @param forwardingConfirmed Whether the dedicated address has forwarded mail.
 * @returns The ask delay in milliseconds.
 */
export function codeWaitAskDelayMs(forwardingConfirmed: boolean) {
  return forwardingConfirmed ? CODE_WAIT_ALIAS_GRACE_MS : CODE_WAIT_PERSONAL_ASK_MS;
}

/**
 * The two 409 refusal codes `POST /api/mail/code-waits/:id` returns, shared so
 * the client branches on the same spelling the server sends (SPEC §11.1).
 */
export const CODE_WAIT_ERRORS = {
  alreadyResolved: "already_resolved",
  expired: "expired",
} as const;
