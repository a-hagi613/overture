import { useSyncExternalStore } from "react";

import { cn } from "./cn.ts";
import { HoverPlayCard } from "./hover-play-card.tsx";

export interface HeroVideoAsset {
  /** PNG frame that paints before the video decodes. */
  poster: string;
  /** H.264 MP4, muted, seamless loop. */
  src: string;
}

export interface HeroVideoLabels {
  pause: string;
  paused: string;
  play: string;
  playing: string;
}

export interface HeroVideoPlayerProps {
  className?: string;
  desktop: HeroVideoAsset;
  labels: HeroVideoLabels;
  mobile: HeroVideoAsset;
  /** Accessible name for the video itself. */
  name: string;
}

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const query = globalThis.matchMedia(DESKTOP_QUERY);

  query.addEventListener("change", onChange);

  return () => {
    query.removeEventListener("change", onChange);
  };
}

function desktopSnapshot() {
  return globalThis.matchMedia(DESKTOP_QUERY).matches;
}

function desktopServerSnapshot() {
  return true;
}

function useDesktopLayout() {
  return useSyncExternalStore(subscribeDesktop, desktopSnapshot, desktopServerSnapshot);
}

/**
 * Product walkthrough player backed by HoverPlayCard: hovers or clicks to preview the workspace
 * recording cleanly with no surrounding chrome, and swaps to the 9:16 mobile recording below `lg`.
 *
 * @param props Desktop and mobile video assets, accessible video name, and play/pause labels.
 * @returns Frameless responsive HoverPlayCard video player.
 */
export function HeroVideoPlayer(props: HeroVideoPlayerProps) {
  const { className, desktop, labels, mobile, name } = props;
  const desktopLayout = useDesktopLayout();
  const asset = desktopLayout ? desktop : mobile;

  return (
    <div className={cn("mt-4", className)}>
      <HoverPlayCard
        className={
          desktopLayout
            ? "mx-auto aspect-[16/10] w-full"
            : "mx-auto aspect-[9/16] w-full max-w-[360px]"
        }
        height={desktopLayout ? 800 : 1280}
        name={name}
        pauseLabel={labels.pause}
        pausedBadge={labels.paused}
        playLabel={labels.play}
        playingBadge={labels.playing}
        poster={asset.poster}
        src={asset.src}
        width={desktopLayout ? 1280 : 720}
      />
    </div>
  );
}
