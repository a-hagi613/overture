import { HeroVideoPlayer } from "../ui/hero-video-player.tsx";
import { dsContainer, dsSectionHeading } from "../ui/ds.ts";
import { Badge } from "../ui/badge.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

export function LandingDashboardPreview() {
  return (
    <section
      aria-labelledby="dashboard-preview-title"
      className={`${dsContainer} pb-16 pt-4 sm:pb-24 sm:pt-6`}
      id="dashboard-preview"
    >
      <div className="mx-auto max-w-2xl text-center">
        <Badge size="eyebrow" variant="signal">
          {LANDING_COPY.preview.badge}
        </Badge>
        <h2 className={`${dsSectionHeading} mt-4`} id="dashboard-preview-title">
          {LANDING_COPY.preview.headingPlain}
          <span className="italic">{LANDING_COPY.preview.headingItalic}</span>
        </h2>
      </div>

      <div className="mt-8 flex items-end justify-center lg:justify-start lg:pl-24">
        <div className="inline-flex items-end gap-2 text-muted-foreground">
          <svg
            aria-hidden="true"
            className="h-7 w-7 translate-y-1 text-signal-text"
            fill="none"
            viewBox="0 0 32 32"
          >
            <path
              d="M25 5C15 6 9 13 9 25"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.75"
            />
            <path
              d="M4.5 20.5L9 25.5L13.5 20.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
            />
          </svg>
          <span className="pb-2 font-serif text-base italic text-foreground">
            {LANDING_COPY.preview.hint}
          </span>
        </div>
      </div>

      <HeroVideoPlayer
        desktop={{
          poster: "/videos/workspace-demo-desktop-poster.png",
          src: "/videos/workspace-demo-desktop.mp4",
        }}
        labels={LANDING_COPY.preview.player}
        mobile={{
          poster: "/videos/workspace-demo-mobile-poster.png",
          src: "/videos/workspace-demo-mobile.mp4",
        }}
        name={LANDING_COPY.preview.videoName}
      />
    </section>
  );
}
