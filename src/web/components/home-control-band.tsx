import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import type { HomeResponse } from "../lib/home-api.ts";
import { useRunning } from "../lib/home-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsMono } from "./ui/ds.ts";

function timeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(at));
}

function statusDetailFor(running: boolean, nextSendAt: number | null, zone: string) {
  if (!running) {
    return copy.home.control.pausedDetail;
  }

  if (nextSendAt === null) {
    return copy.home.control.windowNote;
  }

  return `${copy.home.control.windowNote} · ${copy.home.nextSends(timeText(nextSendAt, zone))}`;
}

export function HomeControlBand({ home }: { home: HomeResponse }) {
  const queryClient = useQueryClient();
  const runningMutation = useRunning();
  const { dailyCap, nextSendAt, running, sentToday, timeZone } = home;
  const pct = dailyCap > 0 ? Math.min(100, Math.round((sentToday / dailyCap) * 100)) : 0;
  const statusDetail = statusDetailFor(running, nextSendAt, timeZone);

  const applyRunningState = (next: boolean) => {
    queryClient.setQueryData<HomeResponse>(["home"], (current) => {
      if (current === undefined) {
        return current;
      }

      return {
        ...current,
        pauseReason: next ? null : "user",
        running: next,
      };
    });
  };

  const toggleRunning = (next: boolean) => {
    const previous = running;

    applyRunningState(next);

    toast.success(next ? copy.home.control.resumedToast : copy.home.control.pausedToast, {
      action: {
        label: copy.board.undo,
        onClick: () => {
          applyRunningState(previous);
          runningMutation.mutate(previous);
        },
      },
    });

    runningMutation.mutate(next);
  };

  return (
    <Card
      ariaLabelledBy="home-control-title"
      className="mt-6 overflow-hidden p-5 md:p-6"
      variant="elevated"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${
                running ? "bg-ok animate-hint-pulse" : "bg-signal"
              }`}
            />
            <Badge variant={running ? "ok" : "signal"}>
              {running ? copy.home.running : copy.home.paused}
            </Badge>
          </div>
          <h2 className={`${dsCardTitle} mt-2.5`} id="home-control-title">
            {running ? copy.home.control.runningTitle : copy.home.control.pausedTitle}
          </h2>
          <p className={`${dsBody} mt-1`}>{statusDetail}</p>
        </div>

        <Button
          disabled={runningMutation.isPending}
          onClick={() => {
            toggleRunning(!running);
          }}
          size="lg"
          variant={running ? "secondary" : "primary"}
        >
          {running ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
          <span>{running ? copy.home.control.pauseAction : copy.home.control.resumeAction}</span>
        </Button>
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${running ? "bg-ok" : "bg-signal"}`}
            style={{ width: `${String(pct)}%` }}
          />
        </div>
        <span className={`${dsMono} shrink-0 text-foreground`}>
          {copy.home.control.dailyProgress(sentToday, dailyCap)}
        </span>
      </div>
    </Card>
  );
}
