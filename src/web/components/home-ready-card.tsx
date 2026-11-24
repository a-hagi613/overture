import { ArrowRight, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useReady } from "../lib/ready-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

export function HomeReadyCard({ readyCount }: { readyCount: number }) {
  const { data: ready } = useReady();
  const pendingCards = (ready?.cards ?? []).filter((card) => card.status === "ready");
  const total = pendingCards.length > 0 ? pendingCards.length : readyCount;
  const preview = pendingCards.slice(0, 3);

  return (
    <Card ariaLabelledBy="home-ready-title" className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={dsCardTitle} id="home-ready-title">
            {copy.home.ready.eyebrow}
          </h2>
          <p className={`${dsBody} mt-0.5 text-xs`}>{copy.home.ready.subtitle}</p>
        </div>
        {total > 0 ? (
          <Badge className="shrink-0 tabular-nums" variant="ok">
            {copy.home.ready.countBadge(total)}
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 flex flex-1 flex-col divide-y divide-border">
        {preview.map((card) => {
          const role = card.title ?? card.plan?.postingTitle ?? card.company;

          return (
            <Link
              className="group -mx-2 flex flex-1 items-center justify-between gap-3.5 rounded-lg px-2 py-3.5 transition hover:bg-muted"
              key={card.id}
              to="/ready"
            >
              <CompanyAvatar company={card.company} logoUrl={card.logoUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-snug text-foreground group-hover:text-foreground">
                  {role}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {card.location === null ? card.company : `${card.company} · ${card.location}`}
                </p>
              </div>
              {card.score === null ? null : (
                <Badge className="shrink-0 tabular-nums" variant="signal">
                  {copy.board.matchPercent(card.score)}
                </Badge>
              )}
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground"
              />
            </Link>
          );
        })}

        {preview.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">{copy.home.control.readyEmptyDetail}</p>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        {total > 0 ? (
          <Button asChild className="w-full" size="default" variant="primary">
            <Link to="/ready">
              <span>{copy.home.ready.action}</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button asChild className="w-full" size="default" variant="secondary">
            <Link to="/applications">
              <span>{copy.home.control.viewBoard}</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </Card>
  );
}
