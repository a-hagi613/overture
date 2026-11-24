import { ArrowUpRight } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { BoardCard } from "../lib/board-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsCardTitle } from "./ui/ds.ts";

export function OffersBanner({
  cards,
  onOpen,
}: {
  cards: readonly BoardCard[];
  onOpen: (id: string) => void;
}) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="applications-offers-title"
      className="mt-6 rounded-xl border border-signal/40 bg-signal-soft/50 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={dsCardTitle} id="applications-offers-title">
          {copy.board.offers.title}
        </h2>
        <Badge variant="signal">{cards.length}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{copy.board.offers.lead(cards.length)}</p>

      <ul className="mt-3 grid list-none grid-cols-1 gap-2 sm:grid-cols-2">
        {cards.map((card) => (
          <li className="min-w-0" key={card.id}>
            <button
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-signal/30 bg-card p-3 text-left transition hover:border-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
              data-offer-card={card.id}
              onClick={() => {
                onOpen(card.id);
              }}
              type="button"
            >
              <CompanyAvatar company={card.company} logoUrl={card.logoUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {card.company}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {card.title}
                </span>
              </span>
              <ArrowUpRight aria-hidden="true" className="shrink-0 text-signal-text" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
