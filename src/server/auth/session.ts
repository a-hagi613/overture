import type { Auth } from "./index.ts";

import { createClock } from "../platform/ports/clock.ts";
import { notePresence } from "./presence.ts";

const clock = createClock();

/**
 * Reads the Better Auth session behind a request's headers.
 * @param auth The Better Auth instance the request arrived on.
 * @param headers The request headers, including the session cookie.
 * @returns The session, or null when the request carries none that is valid.
 */
export async function readSession(auth: Auth, headers: Headers) {
  const session = await auth.api.getSession({ headers }).catch(() => null);

  if (session !== null) {
    notePresence(session.user.id, clock.now());
  }

  return session;
}

/**
 * The signed-in user behind a request's headers.
 * @param auth The Better Auth instance the request arrived on.
 * @param headers The request headers, including the session cookie.
 * @returns The session's user, or null when nobody is signed in.
 */
export async function readSessionUser(auth: Auth, headers: Headers) {
  const session = await readSession(auth, headers);

  return session?.user ?? null;
}
