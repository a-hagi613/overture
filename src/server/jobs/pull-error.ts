const URL_CREDENTIALS = /\/\/[^/@\s]+@/gu;

export const PULL_ALERT_ERROR_MAX_CHARS = 300;

/**
 * Strips credentials from any URL in a pull error and caps how much text an alert or diagnostic prints.
 * @param message The error message from a failed pull.
 * @param maxChars The longest text to keep; defaults to the alert cap.
 * @returns The redacted, capped message.
 */
export function redactPullError(message: string, maxChars: number = PULL_ALERT_ERROR_MAX_CHARS) {
  return message.replaceAll(URL_CREDENTIALS, "//[redacted]@").slice(0, maxChars);
}
