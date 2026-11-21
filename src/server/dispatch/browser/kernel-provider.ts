import type { Clock } from "../../platform/ports/clock.ts";
import type { BrowserProfileStore } from "./profiles.ts";
import type { BrowserProvider, OpenBrowserInput } from "./provider.ts";

import type { KernelClient } from "./kernel.ts";

export const KERNEL_METADATA_PURPOSE = "application";

const toMicros = (raw: string | undefined) => {
  const parsed = Number(raw ?? 0);

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1_000_000) : 0;
};

export interface KernelProviderConfig {
  clock: Clock;
  profiles: BrowserProfileStore;
  client: ReturnType<typeof KernelClient>;
}

export function createKernelBrowserProvider(config: KernelProviderConfig) {
  const { clock, profiles, client } = config;

  async function open(input: OpenBrowserInput) {
    const browser = await client.createBrowser({
      attemptId: input.attemptId,
      profileId: input.profileId,
      timeoutSeconds: input.timeoutMinutes * 60,
    });

    const startedAt = clock.now();

    return {
      cdpUrl: browser.cdp_ws_url,
      close: async () => {
        const detail = await client.getBrowser(browser.session_id).catch(() => browser);

        await client.deleteBrowser(browser.session_id);

        return {
          browserMs: detail.usage?.uptime_ms ?? Math.max(0, clock.now() - startedAt),
          costMicros: toMicros(detail.cost?.estimated_usage_spend_usd),
          proxyBytes: 0,
        };
      },
      liveViewUrl: browser.browser_live_view_url ?? null,
      sessionId: browser.session_id,
    };
  }

  async function listOpen() {
    const browsers = await client.listBrowsers();

    return browsers.map((browser) => ({
      attemptId: browser.tags?.attemptId ?? null,
      sessionId: browser.session_id,
    }));
  }

  async function stop(sessionId: string) {
    await client.deleteBrowser(sessionId);
  }

  async function ensureProfile(userId: string, country: string) {
    const existing = profiles.find("kernel", userId);

    if (existing !== undefined) {
      profiles.touch("kernel", userId);

      return existing.providerProfileId;
    }

    const created = await client.createProfile(`overture-${userId}`);

    return profiles.remember({
      countryCode: country,
      provider: "kernel",
      providerProfileId: created.id,
      userId,
    });
  }

  async function deleteProfile(providerProfileId: string) {
    await client.deleteProfile(providerProfileId);
    profiles.forget("kernel", providerProfileId);
  }

  async function view(sessionId: string) {
    let browser: Awaited<ReturnType<typeof client.getBrowser>> | null = null;

    try {
      browser = await client.getBrowser(sessionId);
    } catch {}

    const replays = await client.listReplays(sessionId).catch(() => []);
    const recordingUrl = replays.find((replay) => replay.replay_view_url !== undefined);

    if (browser === null && recordingUrl === undefined) {
      return null;
    }

    const deletedAt = browser?.deleted_at;

    const deleted = deletedAt !== null && deletedAt !== undefined;
    const active = browser !== null && !deleted;

    let liveViewUrl: string | null = null;

    if (browser !== null && active) {
      liveViewUrl = browser.browser_live_view_url ?? null;
    }

    const status: "active" | "stopped" = active ? "active" : "stopped";

    return {
      liveViewUrl,
      recordingUrl: recordingUrl?.replay_view_url ?? null,
      status,
    };
  }

  return {
    id: "kernel",
    deleteProfile,
    ensureProfile,
    listOpen,
    open,
    stop,
    view,
  } satisfies BrowserProvider;
}

export type KernelBrowserProvider = ReturnType<typeof createKernelBrowserProvider>;
