import { z } from "zod";

import type { LocalChromium } from "./local-chromium.fixture.ts";

import { launchLocalChromium } from "./local-chromium.fixture.ts";

export const recordedProxyUsedMb = "2.71";
export const recordedProxyCost = "0.0136";
export const recordedBrowserCost = "0.0152";
export const recordedBrowserSeconds = 556;

const createSchema = z.object({
  profileId: z.uuid().nullable().optional(),
  proxyCountryCode: z.string().length(2),
  timeout: z.number().int().positive(),
  solveCaptchas: z.boolean(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const profileSchema = z.object({
  name: z.string().min(1),
  userId: z.string().min(1),
});

interface SessionState {
  id: string;
  profileId: string | null;
  attemptId: string | null;
  stopped: boolean;
  chromium: LocalChromium;
  startedAt: string;
}

export interface BrowserUseFixture {
  url: string;
  sessions: SessionState[];
  stoppedSessionIds: string[];
  stoppedAttemptIds: string[];
  profiles: { id: string; name: string; userId: string }[];
  deletedProfileIds: string[];
  peakActiveSessions: number;
  rateLimitResponses: number;
  close: () => void;
}

export interface BrowserUseFixtureOptions {
  maxConcurrentSessions?: number;
  rateLimitFirstSessionCreates?: number;
}

const bodySchema = z.object({ action: z.literal("stop") });

const view = (session: SessionState) => ({
  browserCost: session.stopped ? recordedBrowserCost : "0",
  cdpUrl: session.chromium.cdpUrl,
  finishedAt: session.stopped
    ? new Date(Date.parse(session.startedAt) + recordedBrowserSeconds * 1000).toISOString()
    : null,
  id: session.id,
  liveUrl: session.stopped ? null : `https://live.browser-use.test/${session.id}`,
  metadata:
    session.attemptId === null ? {} : { attemptId: session.attemptId, purpose: "application" },
  proxyCost: session.stopped ? recordedProxyCost : "0",
  proxyUsedMb: session.stopped ? recordedProxyUsedMb : "0",
  recordingUrl: session.stopped ? `https://recordings.browser-use.test/${session.id}.mp4` : null,
  startedAt: session.startedAt,
  status: session.stopped ? "stopped" : "active",
  timeoutAt: new Date(Date.parse(session.startedAt) + 15 * 60_000).toISOString(),
});

export function startBrowserUseFixture(options: BrowserUseFixtureOptions = {}) {
  const sessions: SessionState[] = [];
  const stoppedSessionIds: string[] = [];
  const stoppedAttemptIds: string[] = [];
  const profiles: { id: string; name: string; userId: string }[] = [];
  const deletedProfileIds: string[] = [];
  let peakActiveSessions = 0;
  let rateLimitResponses = 0;
  let firstCreatesRateLimited = options.rateLimitFirstSessionCreates ?? 0;

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "POST" && path === "/api/v4/profiles") {
        const parsed = profileSchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid profile" }, { status: 422 });
        }

        const profile = { id: crypto.randomUUID(), ...parsed.data };

        profiles.push(profile);

        return Response.json(
          { ...profile, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { status: 201 },
        );
      }

      if (request.method === "DELETE" && path.startsWith("/api/v4/profiles/")) {
        const id = path.slice("/api/v4/profiles/".length);

        deletedProfileIds.push(id);

        return new Response(null, { status: 204 });
      }

      if (request.method === "POST" && path === "/api/v4/browsers") {
        const parsed = createSchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid session" }, { status: 422 });
        }

        const active = sessions.filter((session) => !session.stopped).length;
        const limit = options.maxConcurrentSessions;
        const overLimit = limit !== undefined && active >= limit;
        const forced = firstCreatesRateLimited > 0;

        if (overLimit || forced) {
          if (forced) {
            firstCreatesRateLimited -= 1;
          }

          rateLimitResponses += 1;

          return new Response(
            `Browser Use API 429 on /api/v4/browsers: Free plan limit: ${String(limit ?? 1)} concurrent sessions reached`,
            { status: 429 },
          );
        }

        const chromium = await launchLocalChromium();

        const session: SessionState = {
          attemptId: parsed.data.metadata?.attemptId ?? null,
          chromium,
          id: crypto.randomUUID(),
          profileId: parsed.data.profileId ?? null,
          startedAt: new Date().toISOString(),
          stopped: false,
        };

        sessions.push(session);
        peakActiveSessions = Math.max(peakActiveSessions, active + 1);

        return Response.json(view(session), { status: 201 });
      }

      if (request.method === "GET" && path === "/api/v4/browsers") {
        const active = sessions.filter((session) => !session.stopped);

        return Response.json({
          items: active.map((session) => view(session)),
          pageNumber: 1,
          pageSize: 100,
          totalItems: active.length,
        });
      }

      const sessionId = path.startsWith("/api/v4/browsers/")
        ? path.slice("/api/v4/browsers/".length)
        : null;

      if (sessionId === null) {
        return new Response("not found", { status: 404 });
      }

      const session = sessions.find((candidate) => candidate.id === sessionId);

      if (session === undefined) {
        return new Response("not found", { status: 404 });
      }

      if (request.method === "GET") {
        return Response.json(view(session));
      }

      if (request.method === "PATCH") {
        const parsed = bodySchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid action" }, { status: 422 });
        }

        session.stopped = true;
        stoppedSessionIds.push(session.id);

        if (session.attemptId !== null) {
          stoppedAttemptIds.push(session.attemptId);
        }

        return Response.json(view(session));
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    close: () => {
      for (const session of sessions) {
        session.chromium.close();
      }

      void server.stop(true);
    },
    deletedProfileIds,
    get peakActiveSessions() {
      return peakActiveSessions;
    },
    profiles,
    get rateLimitResponses() {
      return rateLimitResponses;
    },
    sessions,
    stoppedAttemptIds,
    stoppedSessionIds,
    url: `http://127.0.0.1:${String(server.port)}`,
  } satisfies BrowserUseFixture;
}
