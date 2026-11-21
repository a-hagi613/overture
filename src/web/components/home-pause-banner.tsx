import { Link } from "react-router";

import type { ReactNode } from "react";

import type { PauseReason } from "../../shared/copy.ts";

import { copy } from "../../shared/copy.ts";
import { useRunning } from "../lib/home-api.ts";

const FIX_PATH: Record<Exclude<PauseReason, "suspended" | "user">, string> = {
  no_mailbox: "/profile#profile-address",
  no_resume: "/profile#profile-resume",
  onboarding: "/onboarding",
  payment_failed: "/settings",
  plan_ended: "/settings",
};

const BUTTON_CLASS =
  "inline-flex min-h-10 max-[767px]:min-h-11 flex-none items-center justify-center rounded-md border border-foreground bg-foreground px-[18px] text-[13.5px] font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover disabled:opacity-60";

export function HomePauseBanner({ reason }: { reason: PauseReason }) {
  const entry = copy.home.pauseReasons[reason];
  const needsAttention = reason !== "user";
  const mutation = useRunning();

  let fix: ReactNode;

  if (reason === "user") {
    fix = (
      <button
        className={BUTTON_CLASS}
        disabled={mutation.isPending}
        onClick={() => {
          mutation.mutate(true);
        }}
        type="button"
      >
        {entry.fix}
      </button>
    );
  } else if (reason === "suspended") {
    fix = (
      <a className={BUTTON_CLASS} href="mailto:hello@tryoverture.com">
        {entry.fix}
      </a>
    );
  } else {
    fix = (
      <Link className={BUTTON_CLASS} to={FIX_PATH[reason]}>
        {entry.fix}
      </Link>
    );
  }

  return (
    <section
      aria-labelledby="home-pause"
      className={`mt-[22px] flex flex-wrap items-center justify-between gap-x-5 gap-y-3.5 rounded-lg border px-5 py-4 ${
        needsAttention ? "border-need bg-need-soft" : "border-input bg-card"
      }`}
    >
      <div className="flex min-w-0 flex-[1_1_360px] items-center gap-3.5">
        <span
          aria-hidden="true"
          className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full ${
            needsAttention ? "bg-card text-need" : "bg-muted text-foreground"
          }`}
        >
          <svg fill="currentColor" height="14" viewBox="0 0 24 24" width="14">
            <rect height="14" rx="1" width="4" x="6" y="5" />
            <rect height="14" rx="1" width="4" x="14" y="5" />
          </svg>
        </span>
        <p className="text-sm leading-[1.45] text-foreground" id="home-pause">
          <b className="font-bold">{entry.title}</b> {entry.copy}
        </p>
      </div>
      {fix}
    </section>
  );
}
