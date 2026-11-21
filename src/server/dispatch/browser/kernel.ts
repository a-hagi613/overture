import { z } from "zod";

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
    createBrowser: async (input: {
      timeoutSeconds: number;
      profileId: string | null;
      attemptId: string;
    }) => {
      const response = await call("/browsers", {
        body: JSON.stringify({
          captcha_solver: { enabled: true },
          headless: false,
          profile:
            input.profileId === null ? undefined : { id: input.profileId, save_changes: true },
          proxy: { mode: "default" },
          start_replay: true,
          tags: { attemptId: input.attemptId, purpose: "application" },
          timeout_seconds: input.timeoutSeconds,
        }),
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
