import type { Clock } from "../../platform/ports/clock.ts";
import type { BrowserProfileStore } from "./profiles.ts";
import type { BrowserProvider, OpenBrowserInput } from "./provider.ts";

import type { BrowserSession, BrowserUseClient } from "./browser-use.ts";

export const BROWSER_USE_METADATA_PURPOSE = "application";

const USAGE_SETTLE_INTERVAL_MS = 500;
const USAGE_SETTLE_DEADLINE_MS = 30_000;
const PROFILE_PAGE_SIZE = 100;

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
}

export function createBrowserUseBrowserProvider(config: BrowserUseProviderConfig) {
  const { clock, profiles, client } = config;

  async function readSettledUsage(sessionId: string, deadline: number) {
    const session = await client.getSession(sessionId);

    if (!usageUnsettled(session) || clock.now() >= deadline) {
      return session;
    }

    await wait();

    return readSettledUsage(sessionId, deadline);
  }

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

  async function open(input: OpenBrowserInput) {
    const created = await client.createSession({
      metadata: { attemptId: input.attemptId, purpose: BROWSER_USE_METADATA_PURPOSE },
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
        await client.stopSession(created.id);
        const settled = await readSettledUsage(created.id, clock.now() + USAGE_SETTLE_DEADLINE_MS);

        return usageFor(settled, startedAt);
      },
      liveViewUrl: created.liveUrl ?? null,
      sessionId: created.id,
    };
  }

  async function listOpen() {
    const sessions = await client.listSessions({ filterBy: "active", pageSize: PROFILE_PAGE_SIZE });

    return sessions.items.map((session) => ({
      attemptId: session.metadata?.attemptId ?? null,
      sessionId: session.id,
    }));
  }

  async function stop(sessionId: string) {
    await client.stopSession(sessionId);
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
    stop,
    view,
  } satisfies BrowserProvider;
}

export type BrowserUseBrowserProvider = ReturnType<typeof createBrowserUseBrowserProvider>;
