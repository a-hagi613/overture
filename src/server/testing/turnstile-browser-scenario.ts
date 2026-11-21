import { z } from "zod";

export const turnstileBrowserScenarioBody = z.object({
  mode: z.enum(["pass", "error", "timeout", "expired", "hang"]).default("pass"),
  delayMs: z.coerce.number().int().min(0).max(10_000).default(25),
});

export type TurnstileBrowserScenario = z.infer<typeof turnstileBrowserScenarioBody>;

let current: TurnstileBrowserScenario = turnstileBrowserScenarioBody.parse({});

export function setTurnstileBrowserScenario(next: TurnstileBrowserScenario) {
  current = next;
}

export function turnstileBrowserScenario() {
  return current;
}
