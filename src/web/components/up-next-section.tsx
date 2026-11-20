import { copy } from "../../shared/copy.ts";
import { useHomeData } from "../lib/home-api.ts";
import { UpNextCard } from "./up-next-card.tsx";

export function UpNextSection() {
  const homeQuery = useHomeData();
  const postings = homeQuery.data?.upNext ?? [];

  return (
    <section
      aria-labelledby="home-up-next"
      className="mt-6 rounded-lg border border-border bg-card p-6 shadow-sh"
      data-testid="home-up-next"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
        <div>
          <h2 className="font-serif text-[26px] leading-[1.1]" id="home-up-next">
            {copy.home.upNext.heading}
          </h2>
          <p className="mt-[3px] max-w-[62ch] text-[13.5px] text-muted-foreground">
            {copy.home.upNext.intro}
          </p>
        </div>
        <span className="font-serif text-[14px] italic text-muted-foreground">
          {copy.home.upNext.folio}
        </span>
      </div>
      {homeQuery.isPending ? (
        <p className="mt-4 text-[13px] text-muted-foreground">{copy.home.upNext.loading}</p>
      ) : null}
      {homeQuery.data !== undefined && postings.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">{copy.home.upNext.empty}</p>
      ) : null}
      {postings.length > 0 ? (
        <ul className="mt-5" data-testid="up-next-list">
          {postings.map((posting) => (
            <UpNextCard key={posting.id} posting={posting} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
