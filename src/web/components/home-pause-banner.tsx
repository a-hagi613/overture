import type { ReactNode } from "react";
import { Link } from "react-router";

import type { PauseReason } from "../../shared/copy.ts";

import { copy } from "../../shared/copy.ts";
import { useRunning } from "../lib/home-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";

const FIX_PATH: Record<Exclude<PauseReason, "suspended" | "user">, string> = {
  no_mailbox: "/profile/details",
  no_resume: "/profile/resume",
  onboarding: "/onboarding",
  payment_failed: "/profile/billing",
  plan_ended: "/profile/billing",
};

export function HomePauseBanner({ reason }: { reason: PauseReason }) {
  const entry = copy.home.pauseReasons[reason];
  const needsAttention = reason !== "user";
  const mutation = useRunning();

  let fix: ReactNode;

  if (reason === "user") {
    fix = (
      <Button
        disabled={mutation.isPending}
        onClick={() => {
          mutation.mutate(true);
        }}
        size="sm"
        variant="primary"
      >
        {entry.fix}
      </Button>
    );
  } else if (reason === "suspended") {
    fix = (
      <Button asChild size="sm" variant="primary">
        <a href="mailto:hello@tryoverture.com">{entry.fix}</a>
      </Button>
    );
  } else {
    fix = (
      <Button asChild size="sm" variant="primary">
        <Link to={FIX_PATH[reason]}>{entry.fix}</Link>
      </Button>
    );
  }

  return (
    <Card
      ariaLabelledBy="home-pause"
      className={`mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 px-5 py-4 ${
        needsAttention ? "border-need bg-need-soft" : "border-input bg-card"
      }`}
    >
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground" id="home-pause">
        <span className={`font-semibold ${needsAttention ? "text-need" : "text-foreground"}`}>
          {entry.title}
        </span>{" "}
        {entry.copy}
      </p>
      {fix}
    </Card>
  );
}
