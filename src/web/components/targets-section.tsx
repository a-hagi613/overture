import { copy } from "../../shared/copy.ts";
import { ChoiceChip } from "./choice-chip.tsx";
import { AddChip } from "./add-chip.tsx";
import { Section } from "./section.tsx";
import { SectionHead } from "./section-head.tsx";
import { FilterChip } from "./filter-chip.tsx";

const roleKeys = ["role", "role2", "role3", "role4", "role5"] as const;
const locationKeys = ["location1", "location2", "location3"] as const;

function saveButtonLook() {
  return "inline-flex min-h-11 items-center gap-2 rounded-md border border-foreground bg-foreground px-[18px] text-[13.5px] leading-[normal] font-semibold text-btn-ink shadow-[inset_0_1px_0_rgba(255,255,255,.14)] hover:bg-btn-hover max-[767px]:min-h-12";
}

export function TargetsSection() {
  const { targets } = copy.profile;

  return (
    <Section id="profile-targets" labelledBy="profile-targets-heading">
      <SectionHead
        folio={targets.folio}
        headingId="profile-targets-heading"
        intro={targets.intro}
        title={
          <>
            {targets.titlePlain} <span className="italic">{targets.titleItalic}</span>
          </>
        }
      />
      <div className="mt-[18px] flex flex-wrap items-center gap-x-[18px] gap-y-2 rounded-lg border border-border bg-muted p-4 px-[18px]">
        <span className="font-serif text-[52px] leading-none tabular-nums">
          {targets.matchedValue}
        </span>
        <div className="min-w-0 flex-[1_1_240px]">
          <p className="text-[14.5px] font-semibold">{targets.matchedLabel}</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{targets.matchedNote}</p>
        </div>
      </div>
      <div className="mt-[18px] border-t border-border pb-[18px] pt-[18px]">
        <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">{targets.roles}</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {roleKeys.map((role) => (
            <ChoiceChip key={role} removeLabel={copy.profile.facts.remove(targets[role])}>
              {targets[role]}
            </ChoiceChip>
          ))}
          <AddChip>{targets.addRole}</AddChip>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-x-10">
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">{targets.locations}</h3>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {locationKeys.map((location) => (
              <ChoiceChip key={location} removeLabel={copy.profile.facts.remove(targets[location])}>
                {targets[location]}
              </ChoiceChip>
            ))}
            <AddChip>{targets.addLocation}</AddChip>
          </div>
        </div>
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">{targets.workplace}</h3>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <FilterChip on={targets.remoteOn}>{targets.remote}</FilterChip>
            <FilterChip on={targets.hybridOn}>{targets.hybrid}</FilterChip>
            <FilterChip on={targets.onSiteOn}>{targets.onSite}</FilterChip>
          </div>
        </div>
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">{targets.seniority}</h3>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <FilterChip on={targets.midOn}>{targets.mid}</FilterChip>
            <FilterChip on={targets.seniorOn}>{targets.senior}</FilterChip>
            <FilterChip on={targets.staffOn}>{targets.staff}</FilterChip>
            <FilterChip on={targets.leadOn}>{targets.lead}</FilterChip>
          </div>
        </div>
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">
            {targets.employmentType}
          </h3>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <FilterChip on={targets.fullTimeOn}>{targets.fullTime}</FilterChip>
            <FilterChip on={targets.partTimeOn}>{targets.partTime}</FilterChip>
            <FilterChip on={targets.contractOn}>{targets.contract}</FilterChip>
          </div>
        </div>
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <label
            className="mb-2 block text-[12.5px] font-semibold leading-[normal]"
            htmlFor="ovt-salary"
          >
            {targets.salaryFloor}
          </label>
          <div className="flex max-w-[380px] items-center gap-2.5">
            <select
              aria-label={targets.currencyLabel}
              className="h-10 w-24 flex-none appearance-none rounded-md border border-input bg-card px-3 pr-9 text-[13.5px] font-medium"
              defaultValue="CAD"
              name="currency"
            >
              <option value="CAD">{targets.currencyCad}</option>
              <option value="USD">{targets.currencyUsd}</option>
            </select>
            <input
              className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-0 text-[13.5px] leading-[normal] font-medium tabular-nums h-10"
              id="ovt-salary"
              inputMode="numeric"
              readOnly
              value={targets.salaryFloorValue}
            />
            <span className="flex-none text-[12.5px] text-muted-foreground">
              {targets.salaryFloorUnit}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{targets.salaryFloorNote}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-[18px]">
        <button className={saveButtonLook()} type="button">
          {targets.submit}
        </button>
        <p className="text-[12.5px] text-muted-foreground">{targets.submitNote}</p>
      </div>
    </Section>
  );
}
