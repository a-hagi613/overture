import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { profiles } from "../platform/db/schema.ts";
import { languagesInputSchema, profileSettingsInputSchema } from "../../shared/targets.ts";

const storedSchema = z.object({
  languages: z.array(z.string()),
  timezone: z.string().nullable(),
});

function settingsFromRow(row: { languages: string; timezone: string | null }) {
  const parsed: unknown = JSON.parse(row.languages);

  return storedSchema.parse({ languages: parsed, timezone: row.timezone });
}

export function createLanguagesService(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  async function read(userId: string) {
    const rows = await db
      .select({ languages: profiles.languages, timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    const row = rows.at(0);

    if (row === undefined) {
      return { languages: [], timezone: null };
    }

    return settingsFromRow(row);
  }

  async function save(userId: string, input: z.input<typeof profileSettingsInputSchema>) {
    const { languages, timezone } = profileSettingsInputSchema.parse(input);

    await db
      .insert(profiles)
      .values({
        userId,
        languages: JSON.stringify(languages),
        timezone,
        createdAt: new Date(clock.now()),
        updatedAt: new Date(clock.now()),
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          languages: JSON.stringify(languages),
          timezone,
          updatedAt: new Date(clock.now()),
        },
      });

    return { languages, timezone };
  }

  async function saveLanguages(userId: string, input: z.input<typeof languagesInputSchema>) {
    const { languages } = languagesInputSchema.parse(input);

    await db
      .insert(profiles)
      .values({
        userId,
        languages: JSON.stringify(languages),
        timezone: null,
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
