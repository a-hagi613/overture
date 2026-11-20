import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { profiles } from "../platform/db/schema.ts";
import { languagesInputSchema, profileSettingsInputSchema } from "../../shared/targets.ts";
import { createTimeZoneService } from "./time-zone.ts";

export function createLanguagesService(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;
  const zones = createTimeZoneService(deps);

  async function read(userId: string) {
    const rows = await db
      .select({ languages: profiles.languages })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    const languages = z.array(z.string()).parse(JSON.parse(rows.at(0)?.languages ?? "[]"));

    return { languages, ...(await zones.current(userId)) };
  }

  async function save(userId: string, input: z.input<typeof profileSettingsInputSchema>) {
    const { languages, timezone } = profileSettingsInputSchema.parse(input);
    const zone = await zones.plan(userId, timezone);

    await db
      .insert(profiles)
      .values({
        userId,
        languages: JSON.stringify(languages),
        ...zone,
        createdAt: new Date(clock.now()),
        updatedAt: new Date(clock.now()),
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          languages: JSON.stringify(languages),
          ...zone,
          updatedAt: new Date(clock.now()),
        },
      });

    return { languages, ...(await zones.current(userId)) };
  }

  async function saveLanguages(userId: string, input: z.input<typeof languagesInputSchema>) {
    const { languages } = languagesInputSchema.parse(input);

    await db
      .insert(profiles)
      .values({
        userId,
        languages: JSON.stringify(languages),
        createdAt: new Date(clock.now()),
        updatedAt: new Date(clock.now()),
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { languages: JSON.stringify(languages), updatedAt: new Date(clock.now()) },
      });

    return (await read(userId)).languages;
  }

  return { read, save, saveLanguages };
}
