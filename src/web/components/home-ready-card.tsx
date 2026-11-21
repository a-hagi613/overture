import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import type { HomeResponse } from "../lib/home-api.ts";

export function HomeReadyCard({ ready }: { ready: HomeResponse["ready"] }) {
  if (ready.ready + ready.approved === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="home-ready-title"
      className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3.5 rounded-lg border border-border bg-card px-6 py-5 shadow-sh"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase leading-[13px] tracking-[0.15em] text-muted-foreground">
          {copy.home.ready.eyebrow}
        </p>
        <h2 className="mt-1 font-serif text-[26px] leading-[1.5]" id="home-ready-title">
          {copy.home.ready.title(ready.ready, ready.approved)}
        </h2>
        {ready.companies.length === 0 ? null : (
          <p className="mt-[3px] text-[12.5px] text-muted-foreground">
            {ready.companies.join(", ")}
          </p>
        )}
      </div>
      <Link
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-foreground bg-foreground px-4 text-[13.5px] font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover"
        to="/ready"
      >
        {copy.home.ready.action}
      </Link>
    </section>
  );
}
