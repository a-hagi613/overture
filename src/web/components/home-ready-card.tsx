import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useReady } from "../lib/ready-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { PanelEmpty } from "./ui/panel-empty.tsx";
import { PanelHeader } from "./ui/panel-header.tsx";
import { PanelList } from "./ui/panel-list.tsx";

export function HomeReadyCard({ readyCount }: { readyCount: number }) {
  const { data: ready } = useReady();
  const pendingCards = (ready?.cards ?? []).filter((card) => card.status === "ready");
  const total = pendingCards.length > 0 ? pendingCards.length : readyCount;
  const preview = pendingCards.slice(0, 3);

  const countBadge =
    total > 0 ? (
      <Badge className="tabular-nums" variant="ok">
        {copy.home.ready.countBadge(total)}
      </Badge>
    ) : undefined;

  return (
    <Card ariaLabelledBy="home-ready-title" className="flex h-full flex-col overflow-hidden">
      <PanelHeader
        action={countBadge}
        className="py-2.5"
        subtitle={copy.home.ready.subtitle}
        title={copy.home.ready.eyebrow}
        titleId="home-ready-title"
      />

      {preview.length === 0 ? (
        <PanelEmpty title={copy.home.control.readyEmptyDetail} />
      ) : (
        <PanelList className="flex-1 py-0.5">
          {preview.map((card) => {
            const role = card.title ?? card.plan?.postingTitle ?? card.company;

            return (
              <Link
                className="group -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition hover:bg-muted"
                key={card.id}
                to="/ready"
              >
                <CompanyAvatar company={card.company} logoUrl={card.logoUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{role}</p>
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
        </PanelList>
      )}
    </Card>
  );
}
