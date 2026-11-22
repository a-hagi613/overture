import { z } from "zod";

import type { LocalChromium } from "./local-chromium.fixture.ts";

import { launchLocalChromium } from "./local-chromium.fixture.ts";

export const recordedUptimeMs = 556_000;
export const recordedCostUsd = "0.0288";

const createSchema = z.object({
  captcha_solver: z.object({ enabled: z.boolean() }).optional(),
  headless: z.boolean().optional(),
  profile: z.object({ id: z.string(), save_changes: z.boolean() }).optional(),
  proxy: z.unknown().optional(),
  start_replay: z.boolean().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  timeout_seconds: z.number().int().positive().optional(),
});

const profileSchema = z.object({ name: z.string().min(1) });

interface KernelSessionState {
  id: string;
  attemptId: string | null;
  profileId: string | null;
  deleted: boolean;
  chromium: LocalChromium;
  createdAt: string;
}

export interface KernelFixture {
  url: string;
  sessions: KernelSessionState[];
  deletedSessionIds: string[];
  deletedAttemptIds: string[];
  deletedProfileIds: string[];
  profiles: { id: string; name: string }[];
  close: () => void;
}

const view = (session: KernelSessionState) => ({
  base_url: `https://proxy.kernel.test/browser/kernel/${session.id}`,
  browser_live_view_url: session.deleted ? undefined : `https://live.kernel.test/${session.id}`,
  captcha_solver: { enabled: true },
  cdp_ws_url: session.chromium.cdpUrl,
  created_at: session.createdAt,
  deleted_at: session.deleted ? new Date().toISOString() : undefined,
  headless: false,
  memory: "8GiB",
  profile:
    session.profileId === null
      ? undefined
      : { id: session.profileId, created_at: session.createdAt },
  region: "us-east",
  session_id: session.id,
  stealth: true,
  tags: session.attemptId === null ? {} : { attemptId: session.attemptId, purpose: "application" },
  timeout_seconds: 900,
  usage: { uptime_ms: recordedUptimeMs },
  webdriver_ws_url: `wss://proxy.kernel.test/webdriver/${session.id}`,
});

export function startKernelFixture() {
  const sessions: KernelSessionState[] = [];
  const deletedSessionIds: string[] = [];
  const deletedAttemptIds: string[] = [];
  const deletedProfileIds: string[] = [];
  const profiles: { id: string; name: string }[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "POST" && path === "/profiles") {
        const parsed = profileSchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json(
            { code: "bad_request", message: "invalid profile" },
            { status: 422 },
          );
        }

        const profile = { id: crypto.randomUUID(), ...parsed.data };

        profiles.push(profile);

        return Response.json({
          ...profile,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      const profileMatch = /^\/profiles\/(?<id>[^/]+)$/u.exec(path);

      if (request.method === "DELETE" && profileMatch?.groups?.id !== undefined) {
        const { id: profileId } = profileMatch.groups;
        const index = profiles.findIndex((profile) => profile.id === profileId);

        if (index === -1) {
          return Response.json({ code: "not_found", message: "no profile" }, { status: 404 });
        }

        profiles.splice(index, 1);
        deletedProfileIds.push(profileId);

        return new Response(null, { status: 204 });
      }

      if (request.method === "POST" && path === "/browsers") {
        const parsed = createSchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ code: "bad_request", message: "invalid" }, { status: 422 });
        }

        const chromium = await launchLocalChromium();

        const session: KernelSessionState = {
          attemptId: parsed.data.tags?.attemptId ?? null,
          chromium,
          createdAt: new Date().toISOString(),
          deleted: false,
          id: crypto.randomUUID(),
          profileId: parsed.data.profile?.id ?? null,
        };

        sessions.push(session);

        return Response.json(view(session));
      }

      if (request.method === "GET" && path === "/browsers") {
        return Response.json(
          sessions.flatMap((session) => (session.deleted ? [] : [view(session)])),
          { headers: { "x-has-more": "false" } },
        );
      }

      const replayMatch = /^\/browsers\/(?<id>[^/]+)\/replays$/u.exec(path);

      if (request.method === "GET" && replayMatch?.groups?.id !== undefined) {
        const { id } = replayMatch.groups;
        const session = sessions.find((candidate) => candidate.id === id);

        if (session === undefined) {
          return Response.json({ code: "not_found", message: "no browser" }, { status: 404 });
        }

        return Response.json([
          {
            finished_at: session.deleted ? new Date().toISOString() : null,
            replay_id: `replay-${id}`,
            replay_view_url: `https://replays.kernel.test/${id}.mp4`,
            started_at: session.createdAt,
          },
        ]);
      }

      const browserMatch = /^\/browsers\/(?<id>[^/]+)$/u.exec(path);
      const id = browserMatch?.groups?.id;

      if (id === undefined) {
        return new Response("not found", { status: 404 });
      }

      const session = sessions.find((candidate) => candidate.id === id);

      if (session === undefined) {
        return Response.json({ code: "not_found", message: "no browser" }, { status: 404 });
      }

      if (request.method === "GET") {
        return Response.json({
          ...view(session),
          cost: { estimated_usage_spend_usd: recordedCostUsd, status: "provisional" },
        });
      }

      if (request.method === "DELETE") {
        session.deleted = true;
        deletedSessionIds.push(session.id);

        if (session.attemptId !== null) {
          deletedAttemptIds.push(session.attemptId);
        }

        session.chromium.close();

        return new Response(null, { status: 204 });
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
    deletedAttemptIds,
    deletedProfileIds,
    deletedSessionIds,
    profiles,
    sessions,
    url: `http://127.0.0.1:${String(server.port)}`,
  } satisfies KernelFixture;
}
