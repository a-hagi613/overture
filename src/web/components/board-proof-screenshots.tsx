import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { stamp } from "../lib/board-format.ts";
import { dsMono } from "./ui/ds.ts";

type Phase = "before_submit" | "after_submit";

const PHASES: { label: string; open: string; phase: Phase }[] = [
  { label: copy.board.proof.before, open: copy.board.proof.openBefore, phase: "before_submit" },
  { label: copy.board.proof.after, open: copy.board.proof.openAfter, phase: "after_submit" },
];

function latestOf(detail: ApplicationDetail, phase: Phase) {
  return detail.screenshots.findLast((screenshot) => screenshot.phase === phase) ?? null;
}

export function BoardProofScreenshots({ detail }: { detail: ApplicationDetail }) {
  const shots = PHASES.map((entry) => {
    const shot = latestOf(detail, entry.phase);

    return {
      label: entry.label,
      open: entry.open,
      phase: entry.phase,
      shot,
    };
  });

  if (shots.every((entry) => entry.shot === null)) {
    return (
      <p className="mt-1.5 text-sm text-muted-foreground">{copy.board.proof.screenshotsMissing}</p>
    );
  }

  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2">
      {shots.map(({ label, open, phase, shot }) => (
        <figure className="min-w-0" key={phase}>
          {shot === null ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-6 text-center text-xs text-muted-foreground">
              {phase === "before_submit"
                ? copy.board.proof.beforeMissing
                : copy.board.proof.afterMissing}
            </p>
          ) : (
            <a
              aria-label={open}
              className="block overflow-hidden rounded-lg border border-border bg-muted transition duration-quick ease-out hover:border-input"
              href={shot.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <img
                alt={label}
                className="max-h-80 w-full bg-card object-contain object-top"
                loading="lazy"
                src={shot.url}
              />
            </a>
          )}
          <figcaption className={`${dsMono} mt-1.5`}>
            {label}
            {shot === null ? "" : ` · ${stamp(shot.at, detail.timeZone)}`}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
