import { copy } from "../../shared/copy.ts";

export function ScoreRing() {
  return (
    <div className="relative flex h-12 w-12 flex-none items-center justify-center">
      <span className="sr-only">{copy.signIn.story.scoreAria}</span>
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 48 48">
        <circle
          cx="24"
          cy="24"
          r="20"
          stroke="var(--color-border)"
          strokeWidth="2"
          style={{ fill: "none" }}
        />
        <circle
          cx="24"
          cy="24"
          r="20"
          stroke="var(--color-foreground)"
          strokeDasharray="114 126"
          strokeLinecap="round"
          style={{ fill: "none" }}
          transform="rotate(-90 24 24)"
        />
        <circle cx="24" cy="4" r="2.6" fill="var(--color-signal)" />
      </svg>
      <span className="relative font-serif text-xl leading-none tabular-nums">
        {copy.signIn.story.score}
      </span>
    </div>
  );
}
