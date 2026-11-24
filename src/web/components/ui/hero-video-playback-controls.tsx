import { Maximize2, Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "./button.tsx";
import { cn } from "./cn.ts";
import type { HeroVideoLabels } from "./hero-video-player.tsx";

export function HeroVideoPlaybackControls({
  className,
  labels,
  onExpand,
  onRestart,
  onToggle,
  playing,
}: {
  className?: string;
  labels: HeroVideoLabels;
  onExpand?: () => void;
  onRestart: () => void;
  onToggle: () => void;
  playing: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-card/95 p-1.5 shadow-sh",
        className,
      )}
    >
      <Button
        ariaLabel={playing ? labels.pause : labels.play}
        onClick={onToggle}
        size="icon"
        variant="secondary"
      >
        {playing ? (
          <Pause aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Play aria-hidden="true" className="h-4 w-4" />
        )}
      </Button>
      <Button ariaLabel={labels.restart} onClick={onRestart} size="icon" variant="secondary">
        <RotateCcw aria-hidden="true" className="h-4 w-4" />
      </Button>
      {onExpand === undefined ? null : (
        <Button ariaLabel={labels.expand} onClick={onExpand} size="icon" variant="secondary">
          <Maximize2 aria-hidden="true" className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
