import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { profiles } from "../platform/db/schema.ts";
import { languagesInputSchema } from "../../shared/targets.ts";

const storedSchema = z.object({ languages: z.array(z.string()) });

function languagesFromColumn(value: string) {
  const parsed: unknown = JSON.parse(value);

  return storedSchema.parse({ languages: parsed }).languages;
}

export function createLanguagesService(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  async function read(userId: string) {
    const rows = await db
      .select({ languages: profiles.languages })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    const row = rows.at(0);

    if (row === undefined) {
      return [];
    }

    return languagesFromColumn(row.languages);
  }

  async function save(userId: string, input: z.input<typeof languagesInputSchema>) {
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

    return languages;
  }

  return { read, save };
}
