import { z } from "zod";

const setupSchema = z.object({ url: z.url() });

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
    return "granted";
  }

  if (response.status === 402) {
    return "declined";
  }

  if (response.status === 409) {
    return "used";
  }

  throw new Error(`The card check did not go through (${String(response.status)}).`);
}
