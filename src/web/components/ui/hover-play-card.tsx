import { Pause, Play } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { Button } from "./button.tsx";
import { cn } from "./cn.ts";

export interface HoverPlayCardProps {
  className?: string | undefined;
  height?: number | undefined;
  loop?: boolean | undefined;
  mutedOnHover?: boolean | undefined;
  name: string;
  pauseLabel: string;
  pausedBadge: string;
  playLabel: string;
  playingBadge: string;
  poster?: string | undefined;
  src: string;
  width?: number | undefined;
}

/**
 * Interactive video card matching the HoverPlayCard pattern: plays muted on hover,
 * pauses on mouse leave unless the viewer clicked Play, and displays a centered
 * Play/Pause overlay alongside a subtle bottom-left status badge.
 * @param props Media source, sizing, playback flags, and accessible UI labels.
 * @returns Hover-to-play video card container.
 */
export function HoverPlayCard(props: HoverPlayCardProps) {
  const {
    className,
    height,
    loop = true,
    mutedOnHover = true,
    name,
    pauseLabel,
    pausedBadge,
    playLabel,
    playingBadge,
    poster,
    src,
    width,
  } = props;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prevMutedRef = useRef<boolean | null>(null);
  const reduceMotion = useReducedMotion() === true;

  const [isHovering, setIsHovering] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [userStarted, setUserStarted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    let ignore = false;

    async function playMuted(target: HTMLVideoElement) {
      prevMutedRef.current ??= target.muted;

      if (mutedOnHover) {
        target.muted = true;
      }

      try {
        await target.play();

        if (!ignore) {
          setIsPlaying(true);
        }
      } catch {
        if (!ignore) {
          setIsPlaying(false);
        }
      }
    }

    if (video?.getAttribute("src") === src) {
      if (isHovering && !userStarted && !reduceMotion) {
        void playMuted(video);
      } else if (!isHovering && !userStarted) {
        video.pause();

        if (prevMutedRef.current !== null) {
          video.muted = prevMutedRef.current;
        }
      }
    }

    return () => {
      ignore = true;
    };
  }, [isHovering, mutedOnHover, reduceMotion, src, userStarted]);

  async function togglePlayback(video: HTMLVideoElement) {
    if (!video.paused) {
      video.pause();

      return;
    }

    setUserStarted(true);
    video.muted = true;
    prevMutedRef.current = true;

    try {
      await video.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }

  const handleToggleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const video = videoRef.current;

    if (video === null) {
      return;
    }

    void togglePlayback(video);
  };

  const handleLoadedData = async () => {
    const video = videoRef.current;

    if (video === null || !isHovering || reduceMotion || userStarted || !video.paused) {
      return;
    }

    if (mutedOnHover) {
      video.muted = true;
    }

    try {
      await video.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  return (
    <div
      className={cn("group relative overflow-hidden rounded-xl shadow-sm", className)}
      onBlur={(event) => {
        const next = event.relatedTarget;

        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setHasFocus(false);
        }
      }}
      onFocus={() => {
        setHasFocus(true);
      }}
      onMouseEnter={() => {
        setIsHovering(true);
      }}
      onMouseLeave={() => {
        setIsHovering(false);

        if (videoRef.current?.paused !== false) {
          setUserStarted(false);
        }
      }}
    >
      <video
        aria-label={name}
        className="block h-full w-full object-cover"
        height={height}
        loop={loop}
        muted
        onEnded={() => {
          setIsPlaying(false);
          setUserStarted(false);
        }}
        onLoadedData={() => {
          void handleLoadedData();
        }}
        onPause={() => {
          setIsPlaying(false);
        }}
        onPlay={() => {
          setIsPlaying(true);
        }}
        playsInline
        poster={poster}
        preload="auto"
        ref={videoRef}
        src={src}
        width={width}
      />

      <AnimatePresence>
        {isHovering || hasFocus || !isPlaying ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="overlay"
          >
            <Button
              ariaLabel={isPlaying ? pauseLabel : playLabel}
              className="pointer-events-auto h-16 w-16 rounded-full bg-black/20 text-white hover:bg-black/40 hover:text-white"
              onClick={handleToggleClick}
              size="icon"
              variant="ghost"
            >
              {isPlaying ? (
                <Pause aria-hidden="true" className="h-8 w-8" />
              ) : (
                <Play aria-hidden="true" className="h-8 w-8" />
              )}
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/65 px-2 py-1 text-xs text-white">
        {isPlaying ? playingBadge : pausedBadge}
      </div>
    </div>
  );
}
