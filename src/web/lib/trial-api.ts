import { z } from "zod";

const setupSchema = z.object({ url: z.url() });

const errorBodySchema = z.object({ error: z.string() });

export type TrialCardVerifyOutcome =
  | "already_trialed"
  | "already_used"
  | "declined"
  | "granted"
  | "pending";

export async function startCardSetup() {
  const response = await fetch("/api/billing/trial/setup", { method: "POST" });

  if (!response.ok) {
    throw new Error(`The card check did not start (${String(response.status)}).`);
  }

  return setupSchema.parse(await response.json()).url;
}

export async function verifyTrialCard(sessionId: string) {
  const response = await fetch("/api/billing/trial/verify", {
    body: JSON.stringify({ sessionId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (response.ok) {
    return "granted" as const;
  }

  if (response.status === 202) {
    return "pending" as const;
  }

  if (response.status === 402) {
    return "declined" as const;
  }

  if (response.status === 409) {
    const parsed = errorBodySchema.safeParse(await response.json().catch(() => null));
    const error = parsed.success ? parsed.data.error : "";

    return error === "already_used" ? ("already_used" as const) : ("already_trialed" as const);
  }

  throw new Error(`The card check did not go through (${String(response.status)}).`);
}
