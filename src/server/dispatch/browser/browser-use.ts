import { z } from "zod";

import type { Clock } from "../../platform/ports/clock.ts";

import { RetryLaterError } from "../../platform/jobs/retry.ts";
import { ProviderUnavailableError } from "./provider.ts";

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

const domainListSchema = z.object({ domains: z.array(z.string().min(1)) });

export const networkPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  defaultAction: z.enum(["allow", "block"]).optional(),
  allow: domainListSchema.optional(),
  block: domainListSchema.optional(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type NetworkPolicy = z.infer<typeof networkPolicySchema>;

const networkPolicyListSchema = z.object({
  items: z.array(networkPolicySchema),
  totalItems: z.number().int().nonnegative(),
  pageNumber: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export interface NetworkPolicyInput {
  name: string;
  defaultAction: "allow" | "block";
  allow?: { domains: string[] };
  block?: { domains: string[] };
}

export interface ListNetworkPoliciesInput {
  pageNumber?: number;
  pageSize?: number;
}

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
  networkPolicyId?: string | null;
}

interface CreateSessionBody {
  metadata: Record<string, string>;
  networkPolicyId?: string;
  profileId: string | null;
  proxyCountryCode: string;
  solveCaptchas: boolean;
  timeout: number;
}

export interface ListSessionsInput {
  filterBy?: "active" | "stopped";
  pageNumber?: number;
  pageSize?: number;
}

const apiBase = "https://api.browser-use.com";

const RATE_LIMIT_MAX_RETRIES = 6;
const RATE_LIMIT_BASE_DELAY_MS = 1000;
const RATE_LIMIT_MAX_DELAY_MS = 30_000;

const errors = {
  requestFailed: (status: number, path: string, body: string) =>
    `Browser Use API ${String(status)} on ${path}: ${body.slice(0, 500)}`,
};

export class BrowserUseApiError extends Error {
  readonly retryAfterMs: number | null;
  readonly status: number;

  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);

    this.name = "BrowserUseApiError";
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

const rateLimited = (error: BrowserUseApiError) => error.status === 429;

function retryAfterMilliseconds(header: string | null, now: number) {
  if (header === null) {
    return null;
  }

  const seconds = Number(header);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const at = Date.parse(header);

  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

async function pause(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function BrowserUseClient(apiKey: string, baseUrl: string | undefined, clock: Clock) {
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
      const message = errors.requestFailed(response.status, path, body);

      if (response.status === 402) {
        throw new ProviderUnavailableError("browser_use", "no_credit", message);
      }

      if (response.status === 403) {
        throw new ProviderUnavailableError("browser_use", "forbidden", message);
      }

      throw new BrowserUseApiError(
        response.status,
        message,
        retryAfterMilliseconds(response.headers.get("retry-after"), clock.now()),
      );
    }

    return response;
  };

  const parsedSession = async (path: string, init: RequestInit) => {
    const response = await call(path, init);

    return browserSessionSchema.parse(await response.json());
  };

  const createSession = async (input: CreateSessionInput, attempt = 0) => {
    const body: CreateSessionBody = {
      metadata: input.metadata,
      profileId: input.profileId,
      proxyCountryCode: input.proxyCountryCode,
      solveCaptchas: input.solveCaptchas,
      timeout: input.timeoutMinutes,
    };

    if (input.networkPolicyId !== undefined && input.networkPolicyId !== null) {
      body.networkPolicyId = input.networkPolicyId;
    }

    try {
      return await parsedSession("/api/v4/browsers", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (!(error instanceof BrowserUseApiError) || !rateLimited(error)) {
        throw error;
      }

      const delay =
        error.retryAfterMs ??
        Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);

      if (attempt >= RATE_LIMIT_MAX_RETRIES || delay > RATE_LIMIT_MAX_DELAY_MS) {
        throw new RetryLaterError(error.message, delay);
      }

      await pause(delay);

      return createSession(input, attempt + 1);
    }
  };

  return {
    createSession: async (input: CreateSessionInput) => createSession(input),
    getSession: async (sessionId: string) =>
      parsedSession(`/api/v4/browsers/${sessionId}`, { headers: headers() }),
    listSessions: async (input: ListSessionsInput = {}) => {
      const parameters = new URLSearchParams();

      if (input.filterBy !== undefined) {
        parameters.set("filterBy", input.filterBy);
      }

      parameters.set("pageNumber", String(input.pageNumber ?? 1));
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
    createNetworkPolicy: async (input: NetworkPolicyInput) => {
      const response = await call("/api/v4/network-policies", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(input),
      });

      return networkPolicySchema.parse(await response.json());
    },
    updateNetworkPolicy: async (policyId: string, input: NetworkPolicyInput) => {
      const response = await call(`/api/v4/network-policies/${policyId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(input),
      });

      return networkPolicySchema.parse(await response.json());
    },
    listNetworkPolicies: async (input: ListNetworkPoliciesInput = {}) => {
      const parameters = new URLSearchParams({
        pageNumber: String(input.pageNumber ?? 1),
        pageSize: String(input.pageSize ?? 100),
      });

      const response = await call(`/api/v4/network-policies?${parameters.toString()}`, {
        headers: headers(),
      });

      return networkPolicyListSchema.parse(await response.json());
    },
  };
}

export type BrowserUseApiClient = ReturnType<typeof BrowserUseClient>;
