import { Clock, RotateCcw } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { ReadyCard } from "../lib/ready-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsMono } from "./ui/ds.ts";

function formatSendTime(at: number | null, zone: string) {
  if (at === null) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(copy.home.dateLocale, {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone: zone,
    }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat(copy.home.dateLocale, {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
    }).format(new Date(at));
  }
}

export function ReadyApprovedList(props: {
  busy: boolean;
  cards: readonly ReadyCard[];
  onUnapprove: (card: ReadyCard) => void;
  zone: string;
}) {
  const { busy, cards, onUnapprove, zone } = props;

  return (
    <section aria-label={copy.ready.approvedSectionAria} className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className={dsCardTitle}>{copy.ready.scheduledTitle}</h2>
            <Badge className="tabular-nums" variant="ok">
              {copy.ready.scheduledCount(cards.length)}
            </Badge>
          </div>
          <p className={`${dsBody} mt-1`}>{copy.ready.scheduledNote}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {cards.map((card) => {
          const roleTitle = card.title ?? card.plan?.postingTitle ?? card.company;
          const scheduledAt = formatSendTime(card.sendAt, zone);

          return (
            <Card
              ariaLabelledBy={`scheduled-${card.id}`}
              className="flex flex-wrap items-center justify-between gap-4 p-4 md:px-5"
              key={card.id}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <CompanyAvatar company={card.company} logoUrl={card.logoUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ok">{card.company}</p>
                  <h3
                    className="truncate text-sm font-semibold text-foreground"
                    id={`scheduled-${card.id}`}
                  >
                    {roleTitle}
                  </h3>
                  {scheduledAt === null ? null : (
                    <p className={`${dsMono} mt-1 flex items-center gap-1.5 text-muted-foreground`}>
                      <Clock aria-hidden="true" size={12} />
                      <span>{copy.ready.sendingAround(scheduledAt)}</span>
                    </p>
                  )}
                </div>
              </div>

              <Button
                disabled={busy}
                onClick={() => {
                  onUnapprove(card);
                }}
                size="sm"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" size={14} />
                <span>{copy.ready.scheduledUndo}</span>
              </Button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
