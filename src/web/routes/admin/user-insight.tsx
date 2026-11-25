import { useEffect, useState } from "react";

import { copy } from "../../../shared/copy.ts";
import type { AdminUserInsight } from "../../lib/admin-api.ts";
import { loadUserInsight } from "../../lib/admin-api.ts";
import { InsightAttemptsCard } from "./insight-attempts-card.tsx";
import { InsightCreditsCard } from "./insight-credits-card.tsx";
import { InsightQueueCard } from "./insight-queue-card.tsx";
import { InsightSpendCard } from "./insight-spend-card.tsx";
import { InsightStatusCard } from "./insight-status-card.tsx";
import { InsightTimelineCard } from "./insight-timeline-card.tsx";

/**
 * The person's live picture under their account: status, credits, spend, match queue, browser
 * sends and activity. It loads separately so a slow catalog read never holds the account card.
 * @param props The user id.
 * @param props.userId The person to load.
 * @returns The insight cards, or a short failure line.
 */
export function UserInsight({ userId }: { userId: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "failed" }
    | { insight: AdminUserInsight; kind: "ready"; now: number }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const result = await loadUserInsight(userId);

        if (!alive) {
          return;
        }

        setState(
          result.ok
            ? { insight: result.data.insight, kind: "ready", now: result.data.now }
            : { kind: "failed" },
        );
      } catch {
        if (alive) {
          setState({ kind: "failed" });
        }
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [userId]);

  if (state.kind === "loading") {
    return (
      <div
        aria-busy="true"
        aria-label={copy.admin.insightStatusHeading}
        className="mt-5 grid gap-5 lg:grid-cols-3"
      >
        {[0, 1, 2].map((index) => (
          <div className="h-40 animate-pulse rounded-lg bg-muted" key={index} />
        ))}
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <p className="mt-5 text-xs font-semibold text-need" role="alert">
        {copy.admin.insightLoadFailed}
      </p>
    );
  }

  const { insight, now } = state;

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-3" data-testid="admin-user-insight">
      <InsightStatusCard insight={insight} now={now} />
      <InsightCreditsCard insight={insight} />
      <InsightSpendCard insight={insight} />
      <div className="lg:col-span-2">
        <InsightQueueCard insight={insight} />
      </div>
      <InsightAttemptsCard insight={insight} now={now} />
      <div className="lg:col-span-3">
        <InsightTimelineCard insight={insight} now={now} />
      </div>
    </div>
  );
}
