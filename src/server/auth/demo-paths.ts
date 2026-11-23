const demoAllowedAuthPaths = new Set(["/demo/sign-in", "/get-session", "/sign-out"]);

/**
 * Whether a Better Auth endpoint may run for the demo account. The demo account is a read-only visit, so only reading
 * its own session, signing out and the one-click demo sign-in are allowed; every other endpoint, including session
 * listing, revocation, account linking and passkeys, is refused (#278, Wave 4 security review).
 * @param path The endpoint path Better Auth reports for the request.
 * @returns True only for the endpoints the demo account may use.
 */
export function isDemoAllowedAuthPath(path: string) {
  return demoAllowedAuthPaths.has(path.replace(/\/+$/u, ""));
}
