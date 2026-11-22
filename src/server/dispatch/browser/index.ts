import type { AppDatabase } from "../../platform/db/client.ts";
import type { Clock } from "../../platform/ports/clock.ts";
import type { Env } from "../../config/env.ts";
import type { BrowserProvider } from "./provider.ts";

import { getSetting } from "../../platform/settings/index.ts";
import { raiseAlert } from "../../platform/alerts.ts";
import { BrowserUseClient } from "./browser-use.ts";
import { createBrowserUseBrowserProvider } from "./browser-use-provider.ts";
import { createNetworkPolicyResolver } from "./network-policy.ts";
import { createBrowserProfileStore } from "./profiles.ts";
import { KernelClient } from "./kernel.ts";
import { createKernelBrowserProvider } from "./kernel-provider.ts";
import { createLocalBrowserProvider } from "./local.ts";
import { configureBrowserSessionLimitFromSetting } from "./session-slots.ts";

export function createBrowserProvider(env: Env, clock: Clock, db: AppDatabase) {
  configureBrowserSessionLimitFromSetting(db);

  if (env.BROWSER_PROVIDER === undefined && env.BROWSER_USE_API_KEY === undefined) {
    return null;
  }

  const profiles = createBrowserProfileStore(db, clock);
  const providers = new Map<string, BrowserProvider>();

  if (env.BROWSER_PROVIDER === "local" || env.BROWSER_SESSION_DIR !== undefined) {
    providers.set(
      "local",
      createLocalBrowserProvider({
        clock,
        sessionDirectory: env.BROWSER_SESSION_DIR ?? "data/browsers",
      }),
    );
  }

  if (env.BROWSER_USE_API_KEY !== undefined) {
    const client = BrowserUseClient(env.BROWSER_USE_API_KEY, env.BROWSER_USE_API_BASE_URL, clock);
    const resolveNetworkPolicy = createNetworkPolicyResolver(client);

    providers.set(
      "browser_use",
      createBrowserUseBrowserProvider({
        client,
        clock,
        resolveNetworkPolicyId: async () => {
          try {
            return await resolveNetworkPolicy();
          } catch (error) {
            raiseAlert(db, clock, "browser.network_policy", {
              message: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
            });

            return null;
          }
        },
        profiles,
        usageSettleDeadlineMs: env.BROWSER_USE_USAGE_SETTLE_MS,
      }),
    );
  }

  if (env.KERNEL_API_KEY !== undefined) {
    providers.set(
      "kernel",
      createKernelBrowserProvider({
        client: KernelClient(env.KERNEL_API_KEY, env.KERNEL_API_BASE_URL),
        clock,
        profiles,
      }),
    );
  }

  if (providers.size === 0) {
    throw new Error(
      "BROWSER_PROVIDER=browser_use needs BROWSER_USE_API_KEY, and BROWSER_PROVIDER=kernel needs KERNEL_API_KEY",
    );
  }

  function pick() {
    const requested = env.BROWSER_PROVIDER ?? getSetting(db, "browser.provider") ?? "browser_use";
    const provider = providers.get(requested);

    if (provider === undefined) {
      throw new Error(`the ${requested} browser provider is not configured on this machine`);
    }

    return provider;
  }

  return {
    all: () => [...providers.values()],
    ids: () => [...providers.keys()],
    pick,
  };
}
