const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
] as const;

const TEST_HOST_SUFFIX = ".test";

/**
 * Decides whether a Web Push subscription endpoint may be called by the server.
 * The endpoint is chosen by the browser's user, so it is an outbound URL under
 * user control; only the known push services are allowed (an SSRF guard).
 * @param endpoint The endpoint URL the browser sent.
 * @param nodeEnv The process environment; `.test` hosts are allowed outside production only.
 * @returns Whether the server may POST to the endpoint.
 */
export function isAllowedPushEndpoint(endpoint: string, nodeEnv: string) {
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return false;
  }

  const host = url.hostname.toLowerCase();

  if (nodeEnv !== "production" && host.endsWith(TEST_HOST_SUFFIX)) {
    return true;
  }

  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
