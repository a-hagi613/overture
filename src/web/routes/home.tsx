import { copy } from "../../shared/copy.ts";
import { firstNameOf } from "../lib/identity.ts";
import { authClient } from "../lib/auth-client.ts";
import { PageHeader } from "../components/page-header.tsx";

function dateLine() {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function greetingWord() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return copy.home.greetingMorning;
  }

  return hour < 18 ? copy.home.greetingAfternoon : copy.home.greetingEvening;
}

export function HomePage() {
  const { data: session } = authClient.useSession();
  const name = session === null ? "" : session.user.name;
  const firstName = name === "" ? "" : firstNameOf(name);

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        lead={dateLine()}
        titleNode={
          <>
            {greetingWord()}{" "}
            <span className="italic">{`${firstName === "" ? copy.app.name : firstName}.`}</span>
          </>
        }
      />
      <section
        aria-labelledby="home-status"
        className="mt-7 rounded-lg border border-border bg-card p-6 shadow-sh"
      >
        <h2 id="home-status" className="font-serif text-[22px] leading-[1.15] md:text-[26px]">
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
            <dd className="font-serif text-3xl tabular-nums">{copy.home.applicationsLeftValue}</dd>
          </div>
          <div>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.home.sentToday}
            </dt>
            <dd className="font-serif text-3xl tabular-nums">{copy.home.sentTodayValue}</dd>
          </div>
          <div>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.home.nextSend}
            </dt>
            <dd className="font-serif text-3xl tabular-nums">{copy.home.nextSendValue}</dd>
          </div>
        </dl>
        <p className="mt-6 font-mono text-xs text-muted-foreground">{copy.home.nothingYet}</p>
      </section>
    </div>
  );
}
