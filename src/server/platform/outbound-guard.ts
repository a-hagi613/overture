import { isFixtureHost, isLiveServiceHost } from "../../shared/live-service-hosts.ts";

const GUARDED_ENVIRONMENTS = new Set(["development", "test"]);

export class LiveServiceRequestError extends Error {
  readonly host: string;
  readonly url: string;

  constructor(url: string, method: string, environment: string) {
    const host = new URL(url).hostname;

    super(
      `Refusing live traffic to ${host} from a ${environment} process (ADR 0016): only production may reach an ATS or a paid service. Point the base URL at a local fixture server or seed the recorded fixture instead. (${method} ${url})`,
    );

    this.name = "LiveServiceRequestError";
    this.host = host;
    this.url = url;
  }
}

export function assertNoLiveTraffic(url: string, method: string, environment: string) {
  if (!GUARDED_ENVIRONMENTS.has(environment)) {
    return;
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  if (isFixtureHost(parsed.hostname) || !isLiveServiceHost(parsed.hostname)) {
    return;
  }

  throw new LiveServiceRequestError(url, method, environment);
}

function requestUrlOf(input: RequestInfo | URL) {
  if (input instanceof URL) {
    return input.href;
  }

  return input instanceof Request ? input.url : input;
}

export function createGuardedFetch(original: typeof fetch, environment: string) {
  if (!GUARDED_ENVIRONMENTS.has(environment)) {
    return original;
  }

  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = input instanceof Request ? input.method : (init?.method ?? "GET");

      assertNoLiveTraffic(requestUrlOf(input), method, environment);

      return original(input, init);
    },
    { preconnect: original.preconnect.bind(original) },
  );
}

export function installOutboundGuard(environment: string) {
  const original = globalThis.fetch;

  globalThis.fetch = createGuardedFetch(original, environment);

  return () => {
    globalThis.fetch = original;
  };
}
