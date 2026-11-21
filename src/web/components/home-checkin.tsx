import { copy } from "../../shared/copy.ts";

export function HomeCheckIn() {
  return (
    <section
      aria-labelledby="home-checkin"
      className="flex min-w-0 flex-[2_1_420px] flex-wrap items-center justify-between gap-x-5 gap-y-3.5 rounded-lg border border-border bg-card px-4 pt-[22px] pb-5 shadow-sh min-[768px]:px-6"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase leading-[normal]">
          {copy.home.checkIn.eyebrow}
        </p>
        <h2 className="mt-2 font-serif text-[26px] leading-[1.15]" id="home-checkin">
          {copy.home.checkIn.title}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
          {copy.home.checkIn.note}
        </p>
      </div>
      <button
        className="inline-flex min-h-10 max-[767px]:min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-card px-4 text-[13.5px] font-semibold hover:bg-muted"
        type="button"
      >
        {copy.home.checkIn.action}
      </button>
    </section>
  );
}
