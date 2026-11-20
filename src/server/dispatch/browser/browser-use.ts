import { z } from "zod";

export const browserSessionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "stopped"]),
  liveUrl: z.string().nullable().optional(),
  cdpUrl: z.string().nullable().optional(),
  timeoutAt: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable().optional(),
  proxyUsedMb: z.string().optional(),
  proxyCost: z.string().optional(),
  browserCost: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type BrowserSession = z.infer<typeof browserSessionSchema>;

export interface CreateSessionInput {
  proxyCountryCode: string;
  timeoutMinutes: number;
  solveCaptchas: boolean;
  metadata: Record<string, string>;
}

const apiBase = "https://api.browser-use.com";

const errors = {
  requestFailed: (status: number, path: string, body: string) =>
    `Browser Use API ${String(status)} on ${path}: ${body.slice(0, 500)}`,
};

export function BrowserUseClient(apiKey: string, baseUrl: string | undefined) {
  const root =
    baseUrl !== undefined && baseUrl.trim() !== "" ? baseUrl.replace(/\/+$/u, "") : apiBase;

  const headers = () => ({
    "X-Browser-Use-API-Key": apiKey,
    "content-type": "application/json",
  });

  const call = async (path: string, init: RequestInit) => {
    const response = await fetch(`${root}${path}`, init);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(errors.requestFailed(response.status, path, body));
    }

    return response;
  };

  const parsedSession = async (path: string, init: RequestInit) => {
    const response = await call(path, init);

    return browserSessionSchema.parse(await response.json());
  };

  return {
    createSession: async (input: CreateSessionInput) =>
      parsedSession("/api/v4/browsers", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          proxyCountryCode: input.proxyCountryCode,
          timeout: input.timeoutMinutes,
          solveCaptchas: input.solveCaptchas,
          metadata: input.metadata,
        }),
      }),
    getSession: async (sessionId: string) =>
      parsedSession(`/api/v4/browsers/${sessionId}`, { headers: headers() }),
    stopSession: async (sessionId: string) => {
      const response = await call(`/api/v4/browsers/${sessionId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ action: "stop" }),
      });

      if (response.status !== 204) {
        browserSessionSchema.parse(await response.json());
      }
    },
  };
}

export type BrowserUseApiClient = ReturnType<typeof BrowserUseClient>;
