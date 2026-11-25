import type { ReactNode } from "react";
import { Link } from "react-router";

import type { PauseReason } from "../../shared/copy.ts";

import { copy } from "../../shared/copy.ts";
import { PAUSE_FIX_PATH } from "../lib/pause-paths.ts";
import { useRunning } from "../lib/home-api.ts";
import { Button } from "./ui/button.tsx";
import { StatusStrip } from "./ui/status-strip.tsx";

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
        <Link to={PAUSE_FIX_PATH[reason]}>{entry.fix}</Link>
      </Button>
    );
  }

  return (
    <StatusStrip
      action={fix}
      ariaLabelledBy="home-pause"
      className={needsAttention ? "mt-3 border-need/35 bg-need-soft/45" : "mt-3"}
      description={entry.copy}
      title={entry.title}
      titleId="home-pause"
    />
  );
}
