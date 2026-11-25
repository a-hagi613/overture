/**
 * Who has used the app recently, kept in memory: every signed-in request notes its user, and the
 * admin console reads it to show who is online now. It is not stored, so a restart forgets it;
 * the admin view falls back to the last sign-in for anyone not seen since.
 */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

const lastSeen = new Map<string, number>();

/**
 * Records that a user made a signed-in request.
 * @param userId The signed-in user.
 * @param at When the request arrived.
 */
export function notePresence(userId: string, at: number) {
  const previous = lastSeen.get(userId) ?? 0;

  if (at > previous) {
    lastSeen.set(userId, at);
  }

  if (lastSeen.size > 1000) {
    for (const [id, seenAt] of lastSeen) {
      if (at - seenAt > FORGET_AFTER_MS) {
        lastSeen.delete(id);
      }
    }
  }
}

/**
 * When a user last made a signed-in request since this process started.
 * @param userId The user to look up.
 * @returns Epoch milliseconds, or null when they have not been seen.
 */
export function lastSeenAt(userId: string) {
  return lastSeen.get(userId) ?? null;
}

/**
 * Whether a user made a signed-in request in the online window.
 * @param userId The user to look up.
 * @param now The current instant.
 * @returns True when they were seen in the last five minutes.
 */
export function isOnline(userId: string, now: number) {
  const seenAt = lastSeen.get(userId);

  return seenAt !== undefined && now - seenAt <= ONLINE_WINDOW_MS;
}

/**
 * The users seen in the online window.
 * @param now The current instant.
 * @returns Their ids.
 */
export function onlineUserIds(now: number) {
  return [...lastSeen].flatMap(([userId, seenAt]) =>
    now - seenAt <= ONLINE_WINDOW_MS ? [userId] : [],
  );
}
