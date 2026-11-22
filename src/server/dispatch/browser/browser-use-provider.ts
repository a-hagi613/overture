import type { Clock } from "../../platform/ports/clock.ts";
import type { BrowserProfileStore } from "./profiles.ts";
import type { BrowserProvider, OpenBrowserInput, OpenSession } from "./provider.ts";

import { ProviderUnavailableError } from "./provider.ts";
import type { BrowserSession, BrowserUseClient } from "./browser-use.ts";

export const BROWSER_USE_METADATA_PURPOSE = "application";

const USAGE_SETTLE_INTERVAL_MS = 500;
const USAGE_SETTLE_DEADLINE_MS = 30_000;
const SESSION_PAGE_SIZE = 100;

const toNumber = (raw: string | null | undefined) => {
  const parsed = Number(raw ?? 0);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const parsedTime = (value: string | null | undefined) => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
};

async function wait() {
  await new Promise((resolve) => {
    setTimeout(resolve, USAGE_SETTLE_INTERVAL_MS);
  });
}

const usageUnsettled = (session: BrowserSession) =>
  toNumber(session.proxyUsedMb) === 0 && toNumber(session.proxyCost) === 0;

export interface BrowserUseProviderConfig {
  clock: Clock;
  profiles: BrowserProfileStore;
  client: ReturnType<typeof BrowserUseClient>;
  usageSettleDeadlineMs?: number;
  resolveNetworkPolicyId?: () => Promise<string | null>;
}

export function createBrowserUseBrowserProvider(config: BrowserUseProviderConfig) {
  const { clock, profiles, client } = config;

  const settleDeadlineMs = config.usageSettleDeadlineMs ?? USAGE_SETTLE_DEADLINE_MS;

  const readSettledUsage: (sessionId: string, deadline: number) => Promise<BrowserSession> = async (
    sessionId,
    deadline,
  ) => {
    const session = await client.getSession(sessionId);

    if (!usageUnsettled(session) || clock.now() >= deadline) {
      return session;
    }

    await wait();

    return readSettledUsage(sessionId, deadline);
  };

  function usageFor(session: BrowserSession, fallbackStart: number) {
    const startedAt = parsedTime(session.startedAt) ?? fallbackStart;
    const finishedAt = parsedTime(session.finishedAt) ?? clock.now();

    return {
      browserMs: Math.max(0, finishedAt - startedAt),
      costMicros: Math.round(
        (toNumber(session.proxyCost) + toNumber(session.browserCost)) * 1_000_000,
      ),
      proxyBytes: Math.round(toNumber(session.proxyUsedMb) * 1_000_000),
    };
  }

  const emptyUsage = (startedAt: number) => ({
    browserMs: Math.max(0, clock.now() - startedAt),
    costMicros: 0,
    proxyBytes: 0,
  });

  async function openedUsage(sessionId: string, deadline: number) {
    try {
      return await readSettledUsage(sessionId, deadline);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        throw error;
      }

      return null;
    }
  }

  async function open(input: OpenBrowserInput) {
    const networkPolicyId =
      config.resolveNetworkPolicyId === undefined ? null : await config.resolveNetworkPolicyId();

    const created = await client.createSession({
      metadata: { attemptId: input.attemptId, purpose: BROWSER_USE_METADATA_PURPOSE },
      networkPolicyId,
      profileId: input.profileId,
      proxyCountryCode: input.country,
      solveCaptchas: true,
      timeoutMinutes: input.timeoutMinutes,
    });

    const { cdpUrl } = created;

    if (cdpUrl === null || cdpUrl === undefined || cdpUrl.length === 0) {
      await client.stopSession(created.id).catch(() => undefined);

      throw new Error("the Browser Use session has no CDP URL");
    }

    const startedAt = parsedTime(created.startedAt) ?? clock.now();

    return {
      cdpUrl,
      close: async () => {
        const deadline = clock.now() + settleDeadlineMs;

        try {
          await client.stopSession(created.id);
        } catch (error) {
          if (error instanceof ProviderUnavailableError) {
            throw error;
          }
        }

        const settled = await openedUsage(created.id, deadline);

        return settled === null ? emptyUsage(startedAt) : usageFor(settled, startedAt);
      },
      liveViewUrl: created.liveUrl ?? null,
      sessionId: created.id,
    };
  }

  const listOpen: (pageNumber?: number) => Promise<OpenSession[]> = async (pageNumber = 1) => {
    const sessions = await client.listSessions({
      filterBy: "active",
      pageNumber,
      pageSize: SESSION_PAGE_SIZE,
    });

    const found = sessions.items.map((session) => ({
      attemptId: session.metadata?.attemptId ?? null,
      sessionId: session.id,
    }));

    if (sessions.items.length === 0 || pageNumber * SESSION_PAGE_SIZE >= sessions.totalItems) {
      return found;
    }

    return [...found, ...(await listOpen(pageNumber + 1))];
  };

  async function stop(sessionId: string) {
    await client.stopSession(sessionId);
  }

  async function sessionUsage(sessionId: string) {
    let session: BrowserSession;

    try {
      session = await client.getSession(sessionId);
    } catch {
      return null;
    }

    return { status: session.status, usage: usageFor(session, clock.now()) };
  }

  async function ensureProfile(userId: string, country: string) {
    const existing = profiles.find("browser_use", userId);

    if (existing !== undefined) {
      profiles.touch("browser_use", userId);

      return existing.providerProfileId;
    }

    const created = await client.createProfile({
      name: `overture-${userId}`,
      userId,
    });

    return profiles.remember({
      countryCode: country,
      provider: "browser_use",
      providerProfileId: created.id,
      userId,
    });
  }

  async function deleteProfile(providerProfileId: string) {
    await client.deleteProfile(providerProfileId);
    profiles.forget("browser_use", providerProfileId);
  }

  async function view(sessionId: string) {
    let result: BrowserSession;

    try {
      result = await client.getSession(sessionId);
    } catch {
      return null;
    }

    return {
      liveViewUrl: result.status === "active" ? (result.liveUrl ?? null) : null,
      recordingUrl: result.recordingUrl ?? null,
      status: result.status,
    };
  }

  return {
    id: "browser_use",
    deleteProfile,
    ensureProfile,
    listOpen,
    open,
    sessionUsage,
    stop,
    view,
  } satisfies BrowserProvider;
}

export type BrowserUseBrowserProvider = ReturnType<typeof createBrowserUseBrowserProvider>;
