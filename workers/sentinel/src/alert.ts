export interface SentinelAlert {
  title: string;
  body: string;
  tags: "warning" | "rotating_light" | "white_check_mark";
}

export interface AlertDelivery {
  delivered: boolean;
  detail: string;
}

export const ALERT_TIMEOUT_MS = 10_000;

/**
 * Pushes to the owner's ntfy topic. It never throws: a missing secret, a timeout or a non-2xx
 * answer is reported back so the caller can record it and try again on the next run, and a broken
 * alert path never stops the checks themselves.
 * @param url the ntfy topic URL, or undefined when the secret is not set
 * @param alert the title, body and tag of the push
 * @returns whether the push was delivered and a short reason when it was not
 */
export async function pushAlert(url: string | undefined, alert: SentinelAlert) {
  if (url === undefined || url === "") {
    return { delivered: false, detail: "ALERT_NTFY_URL is not set" } satisfies AlertDelivery;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        title: alert.title,
        tags: alert.tags,
      },
      body: alert.body,
      redirect: "manual",
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "request failed";

    return { delivered: false, detail } satisfies AlertDelivery;
  }

  if (!response.ok) {
    return {
      delivered: false,
      detail: `ntfy answered HTTP ${String(response.status)}`,
    } satisfies AlertDelivery;
  }

  return { delivered: true, detail: "delivered" } satisfies AlertDelivery;
}
