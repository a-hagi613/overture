import { z } from "zod";

import type { BrowserMode } from "./provider.ts";

export const kernelBrowserSchema = z.object({
  session_id: z.string().min(1),
  cdp_ws_url: z.string().min(1),
  browser_live_view_url: z.string().nullish(),
  created_at: z.string(),
  deleted_at: z.string().nullish(),
  headless: z.boolean().optional(),
  timeout_seconds: z.number().int().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  usage: z.object({ uptime_ms: z.number().int().nonnegative() }).optional(),
  cost: z
    .object({
      status: z.enum(["provisional", "pending", "unavailable"]),
      estimated_usage_spend_usd: z.string().optional(),
    })
    .optional(),
});

export type KernelBrowser = z.infer<typeof kernelBrowserSchema>;

const kernelReplaySchema = z.object({
  replay_id: z.string().min(1),
  replay_view_url: z.string().optional(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
});

export type KernelReplay = z.infer<typeof kernelReplaySchema>;

export const kernelProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  last_used_at: z.string().nullish(),
});

export interface CreateKernelBrowserInput {
  timeoutSeconds: number;
  profileId: string | null;
  attemptId: string;
  mode?: BrowserMode;
}

/**
 * The create-session body. Kernel charges $0.06/h headless against $0.48/h
 * headful, so only a bot-block escalation asks for stealth, and the flag is
 * always explicit rather than left to the vendor default.
 * @param input The session's timeout, profile, attempt tag and mode.
 * @returns The JSON body Kernel expects.
 */
export function kernelCreateBrowserBody(input: CreateKernelBrowserInput) {
  const stealth = input.mode === "stealth";

  return {
    captcha_solver: { enabled: true },
    headless: !stealth,
    profile: input.profileId === null ? undefined : { id: input.profileId, save_changes: true },
    proxy: { mode: "default" },
    start_replay: true,
    stealth,
    tags: { attemptId: input.attemptId, purpose: "application" },
    timeout_seconds: input.timeoutSeconds,
  };
}

const apiBase = "https://api.onkernel.com";

const errors = {
  requestFailed: (status: number, path: string, body: string) =>
    `Kernel API ${String(status)} on ${path}: ${body.slice(0, 500)}`,
};

export function KernelClient(apiKey: string, baseUrl: string | undefined) {
  const root =
    baseUrl !== undefined && baseUrl.trim() !== "" ? baseUrl.replace(/\/+$/u, "") : apiBase;

  const call = async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers);

    headers.set("authorization", `Bearer ${apiKey}`);
    headers.set("content-type", "application/json");

    const response = await fetch(`${root}${path}`, { ...init, headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(errors.requestFailed(response.status, path, body));
    }

    return response;
  };

  return {
    createBrowser: async (input: CreateKernelBrowserInput) => {
      const response = await call("/browsers", {
        body: JSON.stringify(kernelCreateBrowserBody(input)),
        method: "POST",
      });

      return kernelBrowserSchema.parse(await response.json());
    },
    getBrowser: async (sessionId: string) => {
      const response = await call(`/browsers/${sessionId}`, {});

      return kernelBrowserSchema.parse(await response.json());
    },
    listBrowsers: async () => {
      const response = await call("/browsers?status=active&limit=100", {});
      const parsed = z.array(kernelBrowserSchema).parse(await response.json());

      return parsed;
    },
    deleteBrowser: async (sessionId: string) => {
      await call(`/browsers/${sessionId}`, { method: "DELETE" });
    },
    listReplays: async (sessionId: string) => {
      const response = await call(`/browsers/${sessionId}/replays`, {});

      return z.array(kernelReplaySchema).parse(await response.json());
    },
    createProfile: async (name: string) => {
      const response = await call("/profiles", {
        body: JSON.stringify({ name }),
        method: "POST",
      });

      return kernelProfileSchema.parse(await response.json());
    },
    deleteProfile: async (profileId: string) => {
      await call(`/profiles/${profileId}`, { method: "DELETE" });
    },
  };
}

export type KernelApiClient = ReturnType<typeof KernelClient>;
