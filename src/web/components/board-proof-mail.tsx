import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { stamp } from "../lib/board-format.ts";
import { Badge } from "./ui/badge.tsx";
import { dsMono } from "./ui/ds.ts";

export function BoardProofMail({ detail }: { detail: ApplicationDetail }) {
  if (detail.mail.length === 0) {
    return <p className="mt-1.5 text-sm text-muted-foreground">{copy.board.proof.emailsMissing}</p>;
  }

  return (
    <ul className="mt-2 list-none space-y-2.5">
      {detail.mail.flatMap((thread) =>
        thread.messages.map((message) => (
          <li className="rounded-lg border border-border bg-muted/40 p-3.5" key={message.id}>
            <div className="flex items-start justify-between gap-2.5">
              <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                {message.subject === "" ? thread.subject : message.subject}
              </p>
              <Badge variant={message.direction === "in" ? "ok" : "outline"}>
                {message.direction === "in"
                  ? copy.board.proof.emailReceived
                  : copy.board.proof.emailSent}
              </Badge>
            </div>
            <p className={`${dsMono} mt-1 break-words`}>
              {`${copy.board.proof.emailFrom} ${message.from} · ${stamp(message.at, detail.timeZone)}`}
            </p>
            {message.snippet === "" ? null : (
              <p className="mt-1.5 break-words text-sm leading-relaxed text-muted-foreground">
                {message.snippet}
              </p>
            )}
          </li>
        )),
      )}
    </ul>
  );
}
