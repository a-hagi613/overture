import { z } from "zod";

const deletionStateSchema = z.object({
  email: z.string(),
  reauthenticated: z.boolean(),
});

export type DeletionState = z.infer<typeof deletionStateSchema>;

export async function fetchDeletionState() {
  const response = await fetch("/api/account/deletion");

  if (!response.ok) {
    throw new Error(`deletion state failed with ${String(response.status)}`);
  }

  return deletionStateSchema.parse(await response.json());
}

export async function sendReauthLink() {
  return fetch("/api/account/reauth/link", { method: "POST" });
}

export async function requestDeletion() {
  return fetch("/api/account/delete", {
    body: JSON.stringify({ confirm: true }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
