import { Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { Card } from "./card.tsx";
import { cn } from "./cn.ts";
import { dsCardTitle, dsEyebrow } from "./ds.ts";
import { HeroVideoPlaybackControls } from "./hero-video-playback-controls.tsx";

export interface HeroVideoAsset {
  /** PNG frame that paints before the video decodes. */
  poster: string;
  /** H.264 MP4, muted, seamless loop. */
  src: string;
}

export interface HeroVideoLabels {
  close: string;
  description: string;
  expand: string;
  note: string;
  pause: string;
  play: string;
  restart: string;
  sampleData: string;
  title: string;
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

function useInView(ref: { current: HTMLElement | null }) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    let observer: IntersectionObserver | undefined;

    if (element !== null) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries.at(0);

          if (entry !== undefined) {
            setInView(entry.isIntersecting);
          }
        },
        { threshold: 0.35 },
      );
      observer.observe(element);
    }

    return () => {
      observer?.disconnect();
    };
  }, [ref]);

  return inView;
}

function usePlayback({
  enabled,
  reducedMotion,
  src,
}: {
  enabled: boolean;
  reducedMotion: boolean;
  src: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [userStarted, setUserStarted] = useState(false);
  const shouldPlay = enabled && !userPaused && (!reducedMotion || userStarted);

  useEffect(() => {
    const video = videoRef.current;

    if (video === null || video.getAttribute("src") !== src) {
      return;
    }

    const play = async () => {
      try {
        await video.play();
      } catch {
        setPlaying(false);
      }
    };

    if (shouldPlay) {
      void play();
    } else {
      video.pause();
    }
  }, [shouldPlay, src]);

  const handleToggle = () => {
    const video = videoRef.current;

    if (video === null) {
      return;
    }

    if (!video.paused) {
      setUserPaused(true);
      setUserStarted(true);
      video.pause();

      return;
    }

    setUserPaused(false);
    setUserStarted(true);

    const play = async () => {
      try {
        await video.play();
      } catch {
        setPlaying(false);
      }
    };

    void play();
  };

  const handleRestart = () => {
    const video = videoRef.current;

    if (video === null) {
      return;
    }

    video.currentTime = 0;
    setUserPaused(false);
    setUserStarted(true);

    const play = async () => {
      try {
        await video.play();
      } catch {
        setPlaying(false);
      }
    };

    void play();
  };

  return {
    handlePause: () => {
      setPlaying(false);
    },
    handlePlay: () => {
      setPlaying(true);
    },
    handleRestart,
    handleToggle,
    playing,
    videoRef,
  };
}

/**
 * A product-showcase player: a muted, looping workspace walkthrough with a poster-first paint, the 9:16 recording
 * below `lg`, and an expanded cinema dialog that keeps Escape, focus return and an accessible title.
 *
 * @param props The two recordings, their accessible labels, and the video's name.
 * @returns The player card.
 */
export function HeroVideoPlayer(props: HeroVideoPlayerProps) {
  const { className, desktop, labels, mobile, name } = props;
  const desktopLayout = useDesktopLayout();
  const reducedMotion = useReducedMotion() === true;
  const asset = desktopLayout ? desktop : mobile;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(stageRef);
  const [expanded, setExpanded] = useState(false);

  const {
    handlePause: handleInlinePause,
    handlePlay: handleInlinePlay,
    handleRestart: handleInlineRestart,
    handleToggle: handleInlineToggle,
    playing: inlinePlaying,
    videoRef: inlineVideoRef,
  } = usePlayback({ enabled: inView && !expanded, reducedMotion, src: asset.src });

  const {
    handlePause: handleCinemaPause,
    handlePlay: handleCinemaPlay,
    handleRestart: handleCinemaRestart,
    handleToggle: handleCinemaToggle,
    playing: cinemaPlaying,
    videoRef: cinemaVideoRef,
  } = usePlayback({ enabled: expanded, reducedMotion, src: asset.src });

  return (
    <Card className={cn("mt-2 overflow-hidden", className)} variant="elevated">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-sidebar px-3 py-2.5 lg:px-4">
        <span className={`${dsEyebrow} inline-flex min-h-8 items-center gap-2`}>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-signal animate-hint-pulse" />
          {labels.title}
        </span>
        <Badge size="sm" variant="signal">
          {labels.sampleData}
        </Badge>
      </div>

      <div className="bg-background p-3 sm:p-4">
        <div
          className={cn(
            "relative overflow-hidden bg-foreground",
            desktopLayout
              ? "aspect-[16/10] rounded-lg border border-border"
              : "mx-auto aspect-[9/16] w-full max-w-[340px] rounded-xl border border-border",
          )}
          ref={stageRef}
        >
          <video
            aria-label={name}
            className="h-full w-full object-cover"
            height={desktopLayout ? 800 : 1280}
            loop
            muted
            onPause={handleInlinePause}
            onPlay={handleInlinePlay}
            playsInline
            poster={asset.poster}
            preload="metadata"
            ref={inlineVideoRef}
            src={asset.src}
            width={desktopLayout ? 1280 : 720}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
          <HeroVideoPlaybackControls
            labels={labels}
            onExpand={() => {
              setExpanded(true);
            }}
            onRestart={handleInlineRestart}
            onToggle={handleInlineToggle}
            playing={inlinePlaying}
          />
          <span className="font-mono text-xs text-muted-foreground">{labels.note}</span>
        </div>
      </div>

      <Root onOpenChange={setExpanded} open={expanded}>
        <Portal>
          <Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm" />
          <Content
            className={cn(
              "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-3 shadow-lifth focus:outline-none sm:p-4",
              desktopLayout ? "w-[min(94vw,1120px)]" : "w-[min(92vw,420px)]",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <Title className={dsCardTitle}>{labels.title}</Title>
              <Button
                ariaLabel={labels.close}
                onClick={() => {
                  setExpanded(false);
                }}
                size="icon"
                variant="ghost"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
            <Description className="sr-only">{labels.description}</Description>

            <div
              className={cn(
                "relative mx-auto overflow-hidden rounded-xl bg-foreground",
                desktopLayout
                  ? "aspect-[16/10] w-full"
                  : "aspect-[9/16] w-full max-w-[calc(70dvh*9/16)]",
              )}
            >
              <video
                aria-label={name}
                className="h-full w-full object-cover"
                height={desktopLayout ? 800 : 1280}
                loop
                muted
                onPause={handleCinemaPause}
                onPlay={handleCinemaPlay}
                playsInline
                poster={asset.poster}
                preload="metadata"
                ref={cinemaVideoRef}
                src={asset.src}
                width={desktopLayout ? 1280 : 720}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
              <HeroVideoPlaybackControls
                labels={labels}
                onRestart={handleCinemaRestart}
                onToggle={handleCinemaToggle}
                playing={cinemaPlaying}
              />
              <span className="font-mono text-xs text-muted-foreground">{labels.note}</span>
            </div>
          </Content>
        </Portal>
      </Root>
    </Card>
  );
}
