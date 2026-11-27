import { copy } from "../../shared/copy.ts";
import type { ReadyCard } from "../lib/ready-api.ts";
import { useReady } from "../lib/ready-api.ts";
import { Badge } from "./ui/badge.tsx";
import { HomeSection } from "./home-section.tsx";
import { HomeSectionRow } from "./home-section-row.tsx";

const MAX_ROWS = 3;

function roleOf(card: ReadyCard) {
  return card.title ?? card.plan?.postingTitle ?? card.company;
}

function metaOf(card: ReadyCard) {
  return card.location === null ? card.company : `${card.company} · ${card.location}`;
}

export function HomeReadyCard({ readyCount }: { readyCount: number }) {
  const { data: ready, isError, refetch } = useReady();
  const pendingCards = (ready?.cards ?? []).filter((card) => card.status === "ready");
  const total = pendingCards.length > 0 ? pendingCards.length : readyCount;
  const preview = pendingCards.slice(0, MAX_ROWS);
  const text = copy.home.sections.ready;

  return (
    <HomeSection
      count={total}
      countLabel={text.count(total)}
      error={isError}
      href="/ready"
      onRetry={() => {
        void refetch();
      }}
      subtitle={text.subtitle}
      title={text.title}
      titleId="home-ready-title"
      variant="ok"
      viewAll={text.viewAll}
    >
      {preview.map((card) => (
        <HomeSectionRow
          key={card.id}
          meta={metaOf(card)}
          title={roleOf(card)}
          to="/ready"
          trailing={
            card.score === null ? undefined : (
              <Badge className="shrink-0 tabular-nums" variant="signal">
                {copy.board.matchPercent(card.score)}
              </Badge>
            )
          }
        />
      ))}
    </HomeSection>
  );
}
