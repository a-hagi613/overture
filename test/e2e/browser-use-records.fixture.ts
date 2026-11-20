import { http, HttpResponse } from "msw";
import { z } from "zod";

const apiOrigin = "https://api.browser-use.com";

export interface RecordedBrowserSession {
  id: string;
  proxyUsedMb: string;
  proxyCost: string;
  browserCost: string;
  browserSeconds: number;
  stopped: boolean;
}

export interface BrowserUseApiState {
  sessionCount: number;
  createdSessions: RecordedBrowserSession[];
  stoppedSessionIds: string[];
  cdpUrlBySession: Record<string, string>;
  readsBySession: Record<string, number>;
  readsBeforeFinalUsage: number;
}

export const recordedProxyUsedMb = "2.71";
export const recordedProxyCost = "0.0136";
export const recordedBrowserCost = "0.0152";
export const recordedBrowserSeconds = 556;

const createSessionRequestSchema = z.object({
  proxyCountryCode: z.string().length(2),
  timeout: z.literal(15),
  solveCaptchas: z.literal(true),
  metadata: z.record(z.string(), z.string()),
});

const stopSessionRequestSchema = z.object({ action: z.literal("stop") });

const sessionIdSchema = z.object({ id: z.string() });

export function browserUseSessionView(session: RecordedBrowserSession, cdpUrl: string | null) {
  const startedAt = new Date(Date.parse("2026-11-20T14:00:00Z"));
  const timeoutAt = new Date(startedAt.getTime() + 15 * 60_000);

  return {
    id: session.id,
    status: session.stopped ? "stopped" : "active",
    liveUrl: null,
    cdpUrl,
    timeoutAt: timeoutAt.toISOString(),
    startedAt: startedAt.toISOString(),
    finishedAt: session.stopped
      ? new Date(startedAt.getTime() + session.browserSeconds * 1000).toISOString()
      : null,
    proxyUsedMb: session.proxyUsedMb,
    proxyCost: session.proxyCost,
    browserCost: session.browserCost,
    agentSessionId: null,
    recordingUrl: null,
    metadata: { purpose: "early_cloud_probe" },
    extensions: [],
  };
}

export function recordedBrowserUseHandlers(cdpUrl: string) {
  const state: BrowserUseApiState = {
    sessionCount: 0,
    createdSessions: [],
    stoppedSessionIds: [],
    cdpUrlBySession: {},
    readsBySession: {},
    readsBeforeFinalUsage: 0,
  };

  const handlers = [
    http.post(`${apiOrigin}/api/v4/browsers`, async ({ request }) => {
      const parsed = createSessionRequestSchema.safeParse(await request.json());

      if (!parsed.success) {
        return new HttpResponse(null, { status: 422 });
      }

      const session = {
        id: crypto.randomUUID(),
        proxyUsedMb: "0",
        proxyCost: "0",
        browserCost: "0",
        browserSeconds: 0,
        stopped: false,
      };

      state.sessionCount += 1;
      state.createdSessions.push(session);
      state.cdpUrlBySession[session.id] = cdpUrl;

      return HttpResponse.json(browserUseSessionView(session, cdpUrl));
    }),
    http.get(`${apiOrigin}/api/v4/browsers/:id`, ({ params }) => {
      const { id } = sessionIdSchema.parse(params);
      const storedUrl = state.cdpUrlBySession[id];
      const session = state.createdSessions.find((candidate) => candidate.id === id);

      if (storedUrl === undefined || session === undefined) {
        return new HttpResponse(null, { status: 404 });
      }

      const reads = (state.readsBySession[id] ?? 0) + 1;

      state.readsBySession[id] = reads;

      const stopped = state.stoppedSessionIds.includes(id);
      const current = stopped ? { ...session, stopped: true } : session;
      const meteringSettled = !stopped || reads > state.readsBeforeFinalUsage;
      const metered = meteringSettled ? current : { ...current, proxyUsedMb: "0", proxyCost: "0" };

      return HttpResponse.json(browserUseSessionView(metered, storedUrl));
    }),
    http.patch(`${apiOrigin}/api/v4/browsers/:id`, async ({ request, params }) => {
      const { id } = sessionIdSchema.parse(params);
      const parsed = stopSessionRequestSchema.safeParse(await request.json());

      if (!parsed.success) {
        return new HttpResponse(null, { status: 422 });
      }

      const session = state.createdSessions.find((candidate) => candidate.id === id);

      if (session === undefined || state.cdpUrlBySession[id] === undefined) {
        return new HttpResponse(null, { status: 404 });
      }

      if (!session.stopped) {
        session.stopped = true;
        session.proxyUsedMb = recordedProxyUsedMb;
        session.proxyCost = recordedProxyCost;
        session.browserCost = recordedBrowserCost;
        session.browserSeconds = recordedBrowserSeconds;
      }

      if (!state.stoppedSessionIds.includes(id)) {
        state.stoppedSessionIds.push(id);
      }

      return HttpResponse.json(browserUseSessionView(session, state.cdpUrlBySession[id]));
    }),
  ];

  return { handlers, state };
}
