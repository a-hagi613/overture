import { copy } from "../../shared/copy.ts";

export function ScoreRing() {
  return (
    <div className="relative flex h-12 w-12 flex-none items-center justify-center">
      <span className="sr-only">{copy.signIn.story.scoreAria}</span>
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 48 48">
        <circle cx="24" cy="24" fill="none" r="20" stroke="var(--color-border)" strokeWidth="2.5" />
        <circle
          cx="24"
          cy="24"
          fill="none"
          r="20"
          stroke="var(--color-signal)"
          strokeDasharray="114 126"
          strokeLinecap="round"
          strokeWidth="2.5"
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="relative font-serif text-card-title leading-none tabular-nums text-signal-text">
        {copy.signIn.story.score}
      </span>
    </div>
  );
}
