import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import type { HomeResponse } from "../lib/home-api.ts";
import { useRunning } from "../lib/home-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsMono } from "./ui/ds.ts";

function timeText(at: number, zone: string) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(at));
}

function statusDetailFor(
  running: boolean,
  pauseReason: HomeResponse["pauseReason"],
  nextSendAt: number | null,
  zone: string,
) {
  if (!running) {
    if (pauseReason !== null && pauseReason !== "user") {
      return copy.home.pauseReasons[pauseReason].copy;
    }

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
  const { dailyCap, nextSendAt, pauseReason, running, sentToday, timeZone } = home;
  const pct = dailyCap > 0 ? Math.min(100, Math.round((sentToday / dailyCap) * 100)) : 0;
  const statusDetail = statusDetailFor(running, pauseReason, nextSendAt, timeZone);
  const canToggleRunning = running || pauseReason === null || pauseReason === "user";

  const applyRunningState = (next: boolean, reason: HomeResponse["pauseReason"]) => {
    queryClient.setQueryData<HomeResponse>(["home"], (current) => {
      if (current === undefined) {
        return current;
      }

      return {
        ...current,
        pauseReason: reason,
        running: next,
      };
    });
  };

  const toggleRunning = (next: boolean) => {
    const previousRunning = running;
    const previousReason = pauseReason;

    applyRunningState(next, next ? null : "user");

    runningMutation.mutate(next, {
      onError: () => {
        applyRunningState(previousRunning, previousReason);
        toast.error(copy.home.control.resumeErrorToast);
      },
      onSuccess: () => {
        toast.success(next ? copy.home.control.resumedToast : copy.home.control.pausedToast, {
          action: {
            label: copy.board.undo,
            onClick: () => {
              applyRunningState(previousRunning, previousReason);
              runningMutation.mutate(previousRunning, {
                onError: () => {
                  applyRunningState(next, next ? null : "user");
                  toast.error(copy.home.control.resumeErrorToast);
                },
              });
            },
          },
        });
      },
    });
  };

  let controlAction: ReactNode;

  if (canToggleRunning) {
    controlAction = (
      <Button
        disabled={runningMutation.isPending}
        onClick={() => {
          toggleRunning(!running);
        }}
        size="sm"
        variant={running ? "secondary" : "primary"}
      >
        {running ? <Pause aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}
        <span>{running ? copy.home.control.pauseAction : copy.home.control.resumeAction}</span>
      </Button>
    );
  } else {
    controlAction = null;
  }

  return (
    <Card
      ariaLabelledBy="home-control-title"
      className="flex h-full flex-col justify-between gap-2.5 overflow-hidden p-3.5 sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                running ? "bg-ok animate-hint-pulse" : "bg-signal"
              }`}
            />
            <h2 className={dsCardTitle} id="home-control-title">
              {running ? copy.home.control.runningTitle : copy.home.control.pausedTitle}
            </h2>
            <Badge variant={running ? "ok" : "signal"}>
              {running ? copy.home.running : copy.home.paused}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{statusDetail}</p>
        </div>

        {controlAction}
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
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
