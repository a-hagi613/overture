function scheduledOf(scheduledFor: readonly (number | null)[]) {
  return scheduledFor
    .filter((at): at is number => at !== null)
    .toSorted((left, right) => left - right);
}

/**
 * Where the person's approved Applications sit in the send queue.
 * @param scheduledFor The send time of each approved Application, if it has one.
 * @param now The current instant.
 * @returns The position of the next scheduled send, and when it is due.
 */
export function sendQueueOf(scheduledFor: readonly (number | null)[], now: number) {
  const scheduled = scheduledOf(scheduledFor);
  const nextIndex = scheduled.findIndex((at) => at >= now);

  if (nextIndex === -1) {
    return { position: null, sendAt: null };
  }

  return { position: nextIndex + 1, sendAt: scheduled[nextIndex] ?? null };
}

/**
 * When the next Application will leave, from one pass over the approved rows.
 * An approved Application with no slot yet is planned for right now, so it
 * reports the current instant rather than a send window.
 * @param input The approved rows' send times, how many are approved and the instant.
 * @returns The next send time, or null when nothing is approved.
 */
export function nextSendAtOf(input: {
  approved: number;
  now: number;
  scheduledFor: readonly (number | null)[];
}) {
  const scheduled = scheduledOf(input.scheduledFor);

  if (scheduled.length > 0) {
    return Math.min(...scheduled);
  }

  return input.approved > 0 ? input.now : null;
}
