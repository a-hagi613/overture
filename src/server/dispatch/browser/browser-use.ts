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
  recordingUrl: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type BrowserSession = z.infer<typeof browserSessionSchema>;

export const browserProfileSchema = z.object({
  id: z.string().min(1),
  userId: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  lastUsedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BrowserProfile = z.infer<typeof browserProfileSchema>;

const browserSessionListSchema = z.object({
  items: z.array(browserSessionSchema),
  totalItems: z.number().int().nonnegative(),
  pageNumber: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export interface CreateSessionInput {
  proxyCountryCode: string;
  timeoutMinutes: number;
  solveCaptchas: boolean;
  metadata: Record<string, string>;
  profileId: string | null;
}

export interface ListSessionsInput {
  filterBy?: "active" | "stopped";
  pageSize?: number;
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
          profileId: input.profileId,
          proxyCountryCode: input.proxyCountryCode,
          timeout: input.timeoutMinutes,
          solveCaptchas: input.solveCaptchas,
          metadata: input.metadata,
        }),
      }),
    getSession: async (sessionId: string) =>
      parsedSession(`/api/v4/browsers/${sessionId}`, { headers: headers() }),
    listSessions: async (input: ListSessionsInput = {}) => {
      const parameters = new URLSearchParams();

      if (input.filterBy !== undefined) {
        parameters.set("filterBy", input.filterBy);
      }

      parameters.set("pageSize", String(input.pageSize ?? 100));

      const response = await call(`/api/v4/browsers?${parameters.toString()}`, {
        headers: headers(),
      });

      return browserSessionListSchema.parse(await response.json());
    },
    stopSession: async (sessionId: string) => {
      const response = await call(`/api/v4/browsers/${sessionId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ action: "stop" }),
      });

      if (response.status === 204) {
        return null;
      }

      return browserSessionSchema.parse(await response.json());
    },
    createProfile: async (input: { name: string; userId: string }) => {
      const response = await call("/api/v4/profiles", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name: input.name, userId: input.userId }),
      });

      return browserProfileSchema.parse(await response.json());
    },
    deleteProfile: async (profileId: string) => {
      await call(`/api/v4/profiles/${profileId}`, { method: "DELETE", headers: headers() });
    },
  };
}

export type BrowserUseApiClient = ReturnType<typeof BrowserUseClient>;
