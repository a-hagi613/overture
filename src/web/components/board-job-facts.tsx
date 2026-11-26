import { ExternalLink } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { money, providerName, workModeText } from "../lib/board-format.ts";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow, dsMono } from "./ui/ds.ts";

export function BoardJobFacts({ detail }: { detail: ApplicationDetail }) {
  const score = detail.match?.score ?? null;
  const reason = detail.match?.reason?.trim() ?? "";
  const salary = money(detail);

  return (
    <Card className="mt-4 p-3.5" variant="muted">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className={dsEyebrow}>{copy.board.job.location}</dt>
          <dd className="mt-0.5 break-words text-sm text-foreground">
            {detail.posting.location ?? copy.board.locationFallback}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={dsEyebrow}>{copy.board.job.workMode}</dt>
          <dd className="mt-0.5 break-words text-sm text-foreground">
            {workModeText(detail.workplace)}
          </dd>
        </div>

        <div className="min-w-0 sm:col-span-2">
          <dt className={dsEyebrow}>{copy.board.job.match}</dt>
          <dd className="mt-1">
            {score === null ? (
              <p className="text-sm text-muted-foreground">{copy.board.job.scoring}</p>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="font-serif text-card-title leading-tight text-foreground">
                  {copy.board.matchPercent(score)}
                </p>
                <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {reason === "" ? copy.board.matchFallbackReason : reason}
                </p>
              </div>
            )}
          </dd>
        </div>

        <div className="min-w-0 sm:col-span-2">
          <dt className={dsEyebrow}>{copy.board.job.posting}</dt>
          <dd className="mt-1">
            <a
              className="inline-flex items-center gap-1.5 break-words text-sm font-semibold text-foreground underline underline-offset-4 transition duration-quick ease-out hover:opacity-80 max-md:min-h-11"
              href={detail.posting.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <span>{copy.board.openPosting}</span>
              <ExternalLink aria-hidden="true" size={14} />
            </a>
          </dd>
        </div>
      </dl>

      {salary === null ? null : <p className={`${dsMono} mt-3`}>{salary}</p>}

      {detail.posting.ats === null ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">{providerName(detail.posting.ats)}</Badge>
        </div>
      )}
    </Card>
  );
}
