import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";

import { LAB_PAGE_KEYS } from "./pages.ts";
import { runLab } from "./runner.ts";

export const LAB_JOB_KIND = "lab.run";

export const labProviderSchema = z.enum(["browser_use", "kernel", "local"]);

export const labRunPayloadSchema = z.object({
  challenge: z.enum(["pass", "blocked"]).default("pass"),
  providers: z.array(labProviderSchema).min(1).max(3).default(["browser_use"]),
  pages: z
    .array(z.enum(LAB_PAGE_KEYS))
    .min(1)
    .default([...LAB_PAGE_KEYS]),
  sessionsPerPage: z.number().int().min(1).max(200).default(1),
});

export type LabRunPayload = z.infer<typeof labRunPayloadSchema>;

export interface LabJobDeps {
  db: AppDatabase;
  clock: Clock;
  providers: BrowserProviderRegistry;
  baseUrl: string;
}

export function parseLabRunPayload(payload: string) {
  return labRunPayloadSchema.parse(JSON.parse(payload));
}

export async function runLabJob(deps: LabJobDeps, payload: string) {
  const parsed = parseLabRunPayload(payload);

  return await runLab(
    { baseUrl: deps.baseUrl, clock: deps.clock, db: deps.db, providers: deps.providers },
    parsed,
  );
}
