import { copy } from "../../shared/copy.ts";
import { ChoiceChip } from "./choice-chip.tsx";

import { Section } from "./section.tsx";
import { SectionHead } from "./section-head.tsx";
import { SourceChip } from "./source-chip.tsx";

const skipCompanyKeys = ["company2", "company3"] as const;

export function SkipSection() {
  const list = copy.profile.skipList;

  return (
    <Section id="profile-skip" labelledBy="profile-skip-heading">
      <SectionHead
        folio={list.folio}
        headingId="profile-skip-heading"
        intro={list.intro}
        title={
          <>
            {list.titlePlain} <span className="italic">{list.titleItalic}</span>
          </>
        }
      />
      <div className="mt-5 flex flex-wrap gap-2">
        <span className="inline-flex min-h-9 items-center gap-0.5 rounded-full border border-input bg-card px-[13px] text-[13px] font-semibold max-[767px]:min-h-11">
          {list.company1}
          <span className="ml-2">
            <SourceChip variant="dashed">{list.currentEmployer}</SourceChip>
          </span>
        </span>
        {skipCompanyKeys.map((company) => (
          <ChoiceChip key={company} removeLabel={copy.profile.facts.remove(list[company])}>
            {list[company]}
          </ChoiceChip>
        ))}
      </div>
      <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
        <label className="flex h-10 min-w-0 max-w-[380px] flex-[1_1_260px] items-center rounded-md border border-input bg-card px-3 max-[767px]:h-11 max-[767px]:max-w-full">
          <input
            aria-label={list.addLabel}
            className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] font-medium text-foreground outline-0 placeholder:text-muted-foreground leading-[normal]"
            placeholder={list.addLabel}
            type="text"
          />
        </label>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-input bg-card px-4 text-[13.5px] leading-[normal] font-semibold hover:bg-muted max-[767px]:min-h-11"
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="16"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {list.add}
        </button>
      </div>
      <p className="mt-3 max-w-[62ch] text-[12.5px] text-muted-foreground">{list.note}</p>
    </Section>
  );
}
