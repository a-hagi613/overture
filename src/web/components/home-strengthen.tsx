import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";

export function HomeStrengthen({ missing }: { missing: number }) {
  return (
    <section
      aria-labelledby="home-strengthen"
      className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3.5 rounded-lg border border-border bg-card px-4 pt-[22px] pb-[22px] shadow-sh min-[768px]:px-6"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase leading-[normal]">
          {copy.home.strengthen.eyebrow}
        </p>
        <h2 className="mt-2 font-serif text-[26px] leading-[1.15]" id="home-strengthen">
          {copy.home.strengthen.title(missing)}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
          {copy.home.strengthen.note}
        </p>
      </div>
      <Link
        className="inline-flex min-h-10 max-[767px]:min-h-11 flex-none items-center justify-center rounded-md border border-foreground bg-foreground px-[18px] text-[13.5px] font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover"
        to="/profile#profile-strengthen"
      >
        {copy.home.strengthen.action}
      </Link>
    </section>
  );
}
