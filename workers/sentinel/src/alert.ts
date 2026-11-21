export interface SentinelAlert {
  title: string;
  body: string;
  tags: "warning" | "rotating_light" | "white_check_mark";
}

export const ALERT_TIMEOUT_MS = 10_000;

/**
 * Pushes to the owner's ntfy topic. Without the secret the sentinel still runs and logs, so a
 * missing binding never hides the checks themselves.
 * @param url the ntfy topic URL, or undefined when the secret is not set
 * @param alert the title, body and tag of the push
 * @returns whether the push was delivered
 */
export async function pushAlert(url: string | undefined, alert: SentinelAlert) {
  if (url === undefined || url === "") {
    return false;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      title: alert.title,
      tags: alert.tags,
    },
    body: alert.body,
    signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`ntfy answered ${String(response.status)}`);
  }

  return true;
}
