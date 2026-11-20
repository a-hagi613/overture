import { copy } from "../../shared/copy.ts";

export function HomePage() {
  return (
    <main>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {copy.home.eyebrow}
      </p>
      <h1 className="mt-2 font-display text-[32px] leading-[1.05] tracking-tight md:text-[42px]">
        {copy.home.title}
      </h1>
      <section
        aria-labelledby="home-status"
        className="mt-8 rounded-[12px] border border-border bg-card p-6"
      >
        <h2 id="home-status" className="font-display text-[22px] leading-[1.15] md:text-[26px]">
          {copy.home.ready}
        </h2>
        <p className="mt-2 max-w-[60ch] text-sm leading-[1.55] text-muted-foreground">
          {copy.home.skeletonNote}
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <div>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.home.applicationsLeft}
            </dt>
            <dd className="font-display text-4xl">{copy.home.applicationsLeftValue}</dd>
          </div>
          <div>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.home.sentToday}
            </dt>
            <dd className="font-display text-4xl">{copy.home.sentTodayValue}</dd>
          </div>
          <div>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.home.nextSend}
            </dt>
            <dd className="font-display text-4xl">{copy.home.nextSendValue}</dd>
          </div>
        </dl>
        <p className="mt-6 font-mono text-xs text-muted-foreground">{copy.home.nothingYet}</p>
      </section>
    </main>
  );
}
