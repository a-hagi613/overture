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
  networkPolicyId: z.string().min(1).optional(),
});

const networkPolicyInputSchema = z.object({
  name: z.string().min(1).max(100),
  defaultAction: z.enum(["allow", "block"]).optional(),
  allow: z.object({ domains: z.array(z.string().min(1)) }).optional(),
  block: z.object({ domains: z.array(z.string().min(1)) }).optional(),
});

export interface FixtureNetworkPolicy {
  id: string;
  name: string;
  defaultAction: "allow" | "block";
  allow: { domains: string[] };
  block: { domains: string[] };
  version: number;
  createdAt: string;
  updatedAt: string;
}

const policyView = (policy: FixtureNetworkPolicy) => ({
  ...policy,
  allow: { domains: [...policy.allow.domains] },
  block: { domains: [...policy.block.domains] },
});

const policyListsConflict = (policy: FixtureNetworkPolicy) =>
  policy.allow.domains.some((domain) => policy.block.domains.includes(domain));

const profileSchema = z.object({
  name: z.string().min(1),
  userId: z.string().min(1),
});

interface SessionState {
  id: string;
  profileId: string | null;
  attemptId: string | null;
  networkPolicyId: string | null;
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
  networkPolicies: FixtureNetworkPolicy[];
  peakActiveSessions: number;
  rateLimitResponses: number;
  settleUsage: () => void;
  close: () => void;
}

export interface BrowserUseFixtureOptions {
  createStatus?: number;
  failStops?: boolean;
  holdUsage?: boolean;
  maxConcurrentSessions?: number;
  rateLimitFirstSessionCreates?: number;
  retryAfterSeconds?: number;
}

const bodySchema = z.object({ action: z.literal("stop") });

const view = (session: SessionState, usageSettled: boolean) => {
  const withheld = session.stopped && !usageSettled;

  return {
    browserCost: session.stopped && !withheld ? recordedBrowserCost : "0",
    cdpUrl: session.chromium.cdpUrl,
    finishedAt: session.stopped
      ? new Date(Date.parse(session.startedAt) + recordedBrowserSeconds * 1000).toISOString()
      : null,
    id: session.id,
    liveUrl: session.stopped ? null : `https://live.browser-use.test/${session.id}`,
    metadata:
      session.attemptId === null ? {} : { attemptId: session.attemptId, purpose: "application" },
    proxyCost: session.stopped && !withheld ? recordedProxyCost : "0",
    proxyUsedMb: session.stopped && !withheld ? recordedProxyUsedMb : "0",
    recordingUrl: session.stopped ? `https://recordings.browser-use.test/${session.id}.mp4` : null,
    startedAt: session.startedAt,
    status: session.stopped ? "stopped" : "active",
    timeoutAt: new Date(Date.parse(session.startedAt) + 15 * 60_000).toISOString(),
  };
};

export function startBrowserUseFixture(options: BrowserUseFixtureOptions = {}) {
  const sessions: SessionState[] = [];
  const stoppedSessionIds: string[] = [];
  const stoppedAttemptIds: string[] = [];
  const profiles: { id: string; name: string; userId: string }[] = [];
  const deletedProfileIds: string[] = [];
  const networkPolicies: FixtureNetworkPolicy[] = [];
  let peakActiveSessions = 0;
  let rateLimitResponses = 0;
  let usageSettled = !options.holdUsage;
  let firstCreatesRateLimited = options.rateLimitFirstSessionCreates ?? 0;

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "POST" && path === "/__fixture__/settle-usage") {
        usageSettled = true;

        return Response.json({ settled: true });
      }

      if (request.method === "GET" && path === "/api/v4/network-policies") {
        return Response.json({
          items: networkPolicies.toReversed().map((policy) => policyView(policy)),
          pageNumber: 1,
          pageSize: 100,
          totalItems: networkPolicies.length,
        });
      }

      if (request.method === "POST" && path === "/api/v4/network-policies") {
        const parsed = networkPolicyInputSchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid network policy" }, { status: 422 });
        }

        const now = new Date().toISOString();

        const policy: FixtureNetworkPolicy = {
          allow: parsed.data.allow ?? { domains: [] },
          block: parsed.data.block ?? { domains: [] },
          createdAt: now,
          defaultAction: parsed.data.defaultAction ?? "allow",
          id: crypto.randomUUID(),
          name: parsed.data.name,
          updatedAt: now,
          version: 1,
        };

        if (policyListsConflict(policy)) {
          return Response.json({ detail: "a domain is in both allow and block" }, { status: 422 });
        }

        networkPolicies.push(policy);

        return Response.json(policyView(policy), { status: 201 });
      }

      if (path.startsWith("/api/v4/network-policies/") && request.method === "PATCH") {
        const id = path.slice("/api/v4/network-policies/".length);
        const policy = networkPolicies.find((candidate) => candidate.id === id);

        if (policy === undefined) {
          return Response.json({ detail: "not found" }, { status: 404 });
        }

        const parsed = networkPolicyInputSchema.partial().safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid network policy" }, { status: 422 });
        }

        const updated: FixtureNetworkPolicy = {
          ...policy,
          allow: parsed.data.allow ?? policy.allow,
          block: parsed.data.block ?? policy.block,
          defaultAction: parsed.data.defaultAction ?? policy.defaultAction,
          name: parsed.data.name ?? policy.name,
          updatedAt: new Date().toISOString(),
          version: policy.version + 1,
        };

        if (policyListsConflict(updated)) {
          return Response.json({ detail: "a domain is in both allow and block" }, { status: 422 });
        }

        networkPolicies.splice(networkPolicies.indexOf(policy), 1, updated);

        return Response.json(policyView(updated));
      }

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

        if (options.createStatus !== undefined) {
          return new Response("Browser Use account cannot start a session", {
            status: options.createStatus,
          });
        }

        const networkPolicyId = parsed.data.networkPolicyId ?? null;

        if (
          networkPolicyId !== null &&
          !networkPolicies.some((policy) => policy.id === networkPolicyId)
        ) {
          return Response.json({ detail: "network policy not found" }, { status: 404 });
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

          const init: ResponseInit = { status: 429 };

          if (options.retryAfterSeconds !== undefined) {
            init.headers = { "retry-after": String(options.retryAfterSeconds) };
          }

          return new Response(
            `Browser Use API 429 on /api/v4/browsers: Free plan limit: ${String(limit ?? 1)} concurrent sessions reached`,
            init,
          );
        }

        const chromium = await launchLocalChromium();

        const session: SessionState = {
          attemptId: parsed.data.metadata?.attemptId ?? null,
          chromium,
          id: crypto.randomUUID(),
          networkPolicyId,
          profileId: parsed.data.profileId ?? null,
          startedAt: new Date().toISOString(),
          stopped: false,
        };

        sessions.push(session);
        peakActiveSessions = Math.max(peakActiveSessions, active + 1);

        return Response.json(view(session, usageSettled), { status: 201 });
      }

      if (request.method === "GET" && path === "/api/v4/browsers") {
        const active = sessions.filter((session) => !session.stopped);

        return Response.json({
          items: active.map((session) => view(session, usageSettled)),
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
        return Response.json(view(session, usageSettled));
      }

      if (request.method === "PATCH") {
        const parsed = bodySchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid action" }, { status: 422 });
        }

        if (options.failStops === true) {
          session.stopped = true;

          return new Response("session already stopped", { status: 404 });
        }

        session.stopped = true;
        stoppedSessionIds.push(session.id);

        if (session.attemptId !== null) {
          stoppedAttemptIds.push(session.attemptId);
        }

        return Response.json(view(session, usageSettled));
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
    networkPolicies,
    profiles,
    get rateLimitResponses() {
      return rateLimitResponses;
    },
    sessions,
    settleUsage: () => {
      usageSettled = true;
    },
    stoppedAttemptIds,
    stoppedSessionIds,
    url: `http://127.0.0.1:${String(server.port)}`,
  } satisfies BrowserUseFixture;
}
