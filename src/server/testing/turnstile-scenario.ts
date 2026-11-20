import { z } from "zod";

import { turnstileActionSchema } from "../../shared/turnstile.ts";

export const turnstileScenarioBody = z.object({
  action: turnstileActionSchema.default("magiclink"),
  hostname: z.string().min(1).default("127.0.0.1"),
  outcome: z.enum(["pass", "replay", "error"]).default("pass"),
});

export type TurnstileScenario = z.infer<typeof turnstileScenarioBody>;

const spentTokens = new Set<string>();

let current: TurnstileScenario = turnstileScenarioBody.parse({});

export function setTurnstileScenario(next: TurnstileScenario) {
  current = next;
  spentTokens.clear();
}

export function turnstileScenario() {
  return current;
}

export function spendTurnstileToken(token: string) {
  if (current.outcome !== "replay") {
    return true;
  }

  if (spentTokens.has(token)) {
    return false;
  }

  spentTokens.add(token);

  return true;
}
