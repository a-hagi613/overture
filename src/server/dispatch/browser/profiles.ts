import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../../platform/db/client.ts";
import type { Clock } from "../../platform/ports/clock.ts";
import type { BrowserProvider } from "./provider.ts";

import { browserProfiles } from "../../platform/db/schema.ts";

export function createBrowserProfileStore(db: AppDatabase, clock: Clock) {
  function find(provider: BrowserProvider["id"], userId: string) {
    return db
      .select()
      .from(browserProfiles)
      .where(and(eq(browserProfiles.provider, provider), eq(browserProfiles.userId, userId)))
      .get();
  }

  return {
    find,
    remember(input: {
      provider: BrowserProvider["id"];
      userId: string;
      providerProfileId: string;
      countryCode: string;
    }) {
      const at = new Date(clock.now());

      db.insert(browserProfiles)
        .values({
          countryCode: input.countryCode,
          createdAt: at,
          lastUsedAt: at,
          provider: input.provider,
          providerProfileId: input.providerProfileId,
          userId: input.userId,
        })
        .onConflictDoUpdate({
          target: [browserProfiles.userId, browserProfiles.provider],
          set: {
            countryCode: input.countryCode,
            lastUsedAt: at,
            providerProfileId: input.providerProfileId,
          },
        })
        .run();

      return input.providerProfileId;
    },
    touch(provider: BrowserProvider["id"], userId: string) {
      db.update(browserProfiles)
        .set({ lastUsedAt: new Date(clock.now()) })
        .where(and(eq(browserProfiles.provider, provider), eq(browserProfiles.userId, userId)))
        .run();
    },
    forget(provider: BrowserProvider["id"], providerProfileId: string) {
      db.delete(browserProfiles)
        .where(
          and(
            eq(browserProfiles.provider, provider),
            eq(browserProfiles.providerProfileId, providerProfileId),
          ),
        )
        .run();
    },
  };
}

export type BrowserProfileStore = ReturnType<typeof createBrowserProfileStore>;
