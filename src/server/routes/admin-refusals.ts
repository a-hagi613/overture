import type { RevealSession } from "../platform/audit/reveal.ts";

export const ADMIN_REFUSAL_CODES = {
  accessRequired: "access_required",
  ownerRequired: "owner_required",
  revealRequired: "reveal_required",
  readOnly: "read_only",
} as const;

export interface OwnerContext {
  userId: string;
  email: string;
}

export interface AdminEnv {
  Variables: { owner: OwnerContext; reveal: RevealSession };
}
