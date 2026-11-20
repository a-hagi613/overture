import { copy } from "../../shared/copy.ts";
import { FactRow } from "../components/fact-row.tsx";
import { Pill } from "../components/pill.tsx";
import { PageHeader } from "../components/page-header.tsx";

const TABS = [
  { key: "resume", ordinal: "1" },
  { key: "facts", ordinal: "2" },
  { key: "targets", ordinal: "3" },
  { key: "skipList", ordinal: "4" },
  { key: "address", ordinal: "5" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function ProfilePage() {
  return (
    <div className="mx-auto max-w-[880px]">
      <PageHeader
        lead={copy.profile.lead}
        titleNode={
          <>
            {copy.profile.titlePlain} <span className="italic">{copy.profile.titleItalic}</span>
          </>
        }
      />
      <nav aria-label={copy.nav.tabBarLabel} className="mt-6 flex gap-5">
        {TABS.map((tab: { key: TabKey; ordinal: string }) => (
          <span className="text-[13.5px] font-semibold" key={tab.key}>
            {copy.profile.tabs[tab.key]}
            <span className="ml-1 font-serif text-[13px] font-normal italic">{tab.ordinal}</span>
          </span>
        ))}
      </nav>
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-[30px] leading-[1.1]">{copy.profile.tabs.resume}</h2>
          <span className="font-serif text-sm italic text-muted-foreground">
            {copy.profile.resume.folio}
          </span>
        </div>
        <p className="mt-1 text-[13.5px] text-muted-foreground">{copy.profile.resume.sub}</p>
        <section className="mt-4 rounded-card border border-border bg-card p-[22px] shadow-sh">
          <div className="flex gap-5">
            <span className="flex h-[52px] w-[44px] flex-none items-end justify-center rounded-sm border border-input pb-1 text-[10px] font-semibold">
              {copy.profile.resume.chip}
            </span>
            <div className="min-w-0">
              <p className="text-sm">{copy.profile.resume.fileName}</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.profile.resume.meta}</p>
            </div>
          </div>
          <p className="mt-6 text-[14.5px] font-semibold">{copy.profile.resume.strongNote}</p>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">{copy.profile.resume.note}</p>
          <div className="mt-4 grid grid-cols-2 gap-5 rounded-md bg-muted p-4">
            <p className="text-[11px] font-semibold text-muted-foreground">
              {copy.profile.resume.sentWith}
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground">
              {copy.profile.resume.factsRead}
            </p>
            <p className="text-sm font-semibold">{copy.profile.resume.sentWithValue}</p>
            <p className="text-sm font-semibold">{copy.profile.resume.factsReadValue}</p>
          </div>
          <div className="mt-5 flex gap-3">
            <button
              className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted"
              type="button"
            >
              {copy.profile.resume.replace}
            </button>
            <button
              className="inline-flex h-11 items-center justify-center rounded-md px-[18px] text-[13.5px] font-semibold hover:bg-muted"
              type="button"
            >
              {copy.profile.resume.download}
            </button>
          </div>
          <p className="mt-4 text-[12.5px] text-muted-foreground">
            {copy.profile.resume.newFileNote}
          </p>
        </section>
        <p className="mt-3 text-[12px] text-muted-foreground">{copy.profile.resume.pageFolio}</p>
      </section>
      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-[30px] leading-[1.1]">{copy.profile.tabs.facts}</h2>
          <span className="font-serif text-sm italic text-muted-foreground">
            {copy.profile.facts.folio}
          </span>
        </div>
        <p className="mt-1 text-[13.5px] text-muted-foreground">{copy.profile.facts.intro}</p>
        <section className="mt-4 rounded-card border border-border bg-card p-[22px] shadow-sh">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[13px] font-semibold">{copy.profile.facts.tier1Title}</h3>
            <Pill>{copy.profile.facts.tier1Scope}</Pill>
          </div>
          <div className="mt-3">
            <FactRow
              label="Legal name"
              usedIn={22}
              chip={copy.profile.facts.typedHere}
              value="Maya Okafor"
            />
            <FactRow
              chip={copy.profile.facts.readOnly}
              chipNote={copy.profile.facts.assignedBy}
              detail={copy.profile.facts.readOnlyNote}
              label="Email"
              value="maya.okafor@mail.tryoverture.com"
            />
            <FactRow
              label="Work authorization"
              usedIn={23}
              chip={copy.profile.facts.typedHere}
              value="Canada: authorized. United States: not authorized."
            />
            <FactRow
              label="Sponsorship required"
              usedIn={21}
              chip={copy.profile.facts.typedHere}
              value="Canada: no. United States: yes."
            />
            <FactRow
              label="Notice period"
              usedIn={9}
              chip={copy.profile.facts.typedHere}
              value="Two weeks"
            />
            <FactRow
              label="Salary expectation"
              usedIn={12}
              chip={copy.profile.facts.typedHere}
              value="USD 110,000 to 128,000"
            />
            <FactRow
              label="Willing to relocate"
              usedIn={9}
              chip={copy.profile.facts.typedHere}
              value="Yes, within Canada"
            />
            <FactRow
              chipNote="Also on your Skip list"
              label="Current employer"
              chip={copy.profile.facts.typedHere}
              value="Brightwave Analytics"
            />
          </div>
          <p className="mt-4 text-[12.5px] text-muted-foreground">{copy.profile.facts.more}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill>{copy.profile.facts.fromResume}</Pill>
            <Pill>{copy.profile.facts.typedHere}</Pill>
          </div>
        </section>
        <section className="mt-8 rounded-card border border-border bg-card p-[22px] shadow-sh">
          <div className="flex items-start gap-6">
            <p className="font-serif text-[52px] leading-none">
              {copy.profile.targets.matchedValue}
            </p>
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold">{copy.profile.targets.matchedLabel}</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {copy.profile.targets.matchedNote}
              </p>
            </div>
            <span className="ml-auto font-serif text-sm italic text-muted-foreground">
              {copy.profile.targets.folio}
            </span>
          </div>
          <p className="mt-6 text-[12.5px] font-semibold">{copy.profile.targets.roles}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {[
              copy.profile.targets.role,
              copy.profile.targets.role2,
              copy.profile.targets.role3,
              copy.profile.targets.role4,
              copy.profile.targets.role5,
            ].map((role: string) => (
              <Pill key={role}>{role}</Pill>
            ))}
            <button
              className="inline-flex h-9 items-center justify-center rounded-full bg-card px-3.5 text-[13px] font-semibold hover:bg-muted"
              type="button"
            >
              {copy.profile.targets.addRole}
            </button>
          </div>
          <p className="mt-5 text-[12.5px] font-semibold">{copy.profile.targets.locations}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {[
              copy.profile.targets.location1,
              copy.profile.targets.location2,
              copy.profile.targets.location3,
            ].map((location: string) => (
              <Pill key={location}>{location}</Pill>
            ))}
            <button
              className="inline-flex h-9 items-center justify-center rounded-full bg-card px-3.5 text-[13px] font-semibold hover:bg-muted"
              type="button"
            >
              {copy.profile.targets.addLocation}
            </button>
          </div>
          <p className="mt-5 text-[12.5px] font-semibold">{copy.profile.targets.workplace}</p>
          <p className="mt-2.5 flex flex-wrap items-center gap-2">
            {[
              copy.profile.targets.remote,
              copy.profile.targets.hybrid,
              copy.profile.targets.onSite,
            ].map((workplace: string) => (
              <span className="rounded-full px-3.5 py-2 text-[13px] font-semibold" key={workplace}>
                {workplace}
              </span>
            ))}
          </p>
          <p className="mt-5 text-[12.5px] font-semibold">{copy.profile.targets.seniority}</p>
          <p className="mt-2.5 flex flex-wrap items-center gap-2">
            {[
              copy.profile.targets.mid,
              copy.profile.targets.senior,
              copy.profile.targets.staff,
              copy.profile.targets.lead,
            ].map((seniority: string) => (
              <span className="rounded-full px-3.5 py-2 text-[13px] font-semibold" key={seniority}>
                {seniority}
              </span>
            ))}
          </p>
          <p className="mt-5 text-[12.5px] font-semibold">{copy.profile.targets.employmentType}</p>
          <p className="mt-2.5 flex flex-wrap items-center gap-2">
            {[
              copy.profile.targets.fullTime,
              copy.profile.targets.partTime,
              copy.profile.targets.contract,
            ].map((employment: string) => (
              <span className="rounded-full px-3.5 py-2 text-[13px] font-semibold" key={employment}>
                {employment}
              </span>
            ))}
          </p>
          <div className="mt-6 flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-semibold">{copy.profile.targets.salaryFloor}</p>
            <span className="text-[12.5px] text-muted-foreground">
              {copy.profile.targets.salaryFloorUnit}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {copy.profile.targets.salaryFloorNote}
          </p>
          <div className="mt-6 flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-[13.5px] font-semibold">{copy.profile.targets.submitLabel}</p>
            <button
              className="inline-flex h-11 flex-none items-center justify-center rounded-md border border-input px-[18px] text-[13.5px] font-semibold hover:bg-muted"
              type="button"
            >
              {copy.profile.targets.submit}
            </button>
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {copy.profile.targets.submitNote}
          </p>
        </section>
      </section>
      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-[30px] leading-[1.1]">{copy.profile.tabs.skipList}</h2>
          <span className="font-serif text-sm italic text-muted-foreground">
            {copy.profile.skipList.folio}
          </span>
        </div>
        <p className="mt-1 text-[13.5px] text-muted-foreground">{copy.profile.skipList.intro}</p>
        <section className="mt-4 rounded-card border border-border bg-card p-[22px] shadow-sh">
          <div className="flex flex-wrap items-center gap-2">
            {[
              copy.profile.skipList.company1,
              copy.profile.skipList.company2,
              copy.profile.skipList.company3,
            ].map((company: string) => (
              <Pill key={company}>{company}</Pill>
            ))}
            <button
              className="inline-flex h-9 items-center justify-center rounded-full bg-card px-3.5 text-[13px] font-semibold hover:bg-muted"
              type="button"
            >
              {copy.profile.skipList.add}
            </button>
          </div>
          <p className="mt-4 text-[12.5px] text-muted-foreground">{copy.profile.skipList.note}</p>
        </section>
      </section>
      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-[30px] leading-[1.1]">
            {copy.profile.address.titlePlain}{" "}
            <span className="italic">{copy.profile.address.titleItalic}</span>
          </h2>
          <span className="font-serif text-sm italic text-muted-foreground">
            {copy.profile.address.folio}
          </span>
        </div>
        <p className="mt-1 text-[13.5px] text-muted-foreground">{copy.profile.address.intro}</p>
        <section className="mt-4 rounded-card border border-border bg-card p-[22px] shadow-sh">
          <p className="font-serif text-[17px]">{copy.profile.address.alias}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
              {copy.profile.address.chip}
            </span>
            <p className="text-[14px] font-semibold">{copy.profile.address.onEveryForm}</p>
          </div>
          <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
            {copy.profile.address.neverNote}
          </p>
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-[13px] font-semibold">{copy.profile.address.repliesTo}</p>
            <p className="text-[14px] font-semibold">{copy.profile.address.repliesToValue}</p>
          </div>
          <p className="mt-4 border-t border-border pt-4 text-[12.5px] text-muted-foreground">
            {copy.profile.address.changeNote}
          </p>
        </section>
      </section>
    </div>
  );
}
