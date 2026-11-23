/**
 * The detail carried by a `process.unhandled` alert.
 *
 * Alert events are published on the event stream, which only the row's owner can read, and the notification body is
 * stored beside them, so an unauthenticated client sees neither. A rejection's message is arbitrary internal text — a
 * mail address, a URL with a token, a row's contents — so only the error type and the running count leave the process;
 * the full cause stays in the log.
 * @param errorName The caught error's constructor name, or `NonError` for a thrown non-error.
 * @param count How many unhandled rejections have been seen since boot.
 * @returns The allowlisted alert detail.
 */
export function unhandledRejectionDetail(errorName: string, count: number) {
  return {
    count,
    error: errorName,
  } satisfies Record<string, string | number | boolean | null>;
}
