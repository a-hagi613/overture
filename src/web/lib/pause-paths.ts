import type { PauseReason } from "../../shared/copy.ts";

export const PAUSE_FIX_PATH: Record<Exclude<PauseReason, "suspended" | "user">, string> = {
  no_mailbox: "/profile/details",
  no_resume: "/profile/resume",
  onboarding: "/onboarding",
  payment_failed: "/profile/billing",
  plan_ended: "/profile/billing",
};
