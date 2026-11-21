import { useState } from "react";
import { useLocation } from "react-router";

import { copy } from "../../shared/copy.ts";
import { FactRow } from "./fact-row.tsx";
import { FilterChip } from "./filter-chip.tsx";
import { Section } from "./section.tsx";
import { SectionHead } from "./section-head.tsx";
import { SourceChip } from "./source-chip.tsx";
import { StrengthenFacts } from "./strengthen-facts.tsx";

type Tier = "tier1" | "tier2";

function chipForKind(kind: string) {
  const { facts } = copy.profile;

  if (kind === "fromResume") {
    return <SourceChip>{facts.fromResume}</SourceChip>;
  }

  if (kind === "typed") {
    return <SourceChip variant="dashed">{facts.typedHere}</SourceChip>;
  }

  return <SourceChip variant="dashed">{facts.assignedBy}</SourceChip>;
}

export function FactsSection() {
  const { facts } = copy.profile;
  const { hash } = useLocation();
  const [tier, setTier] = useState<Tier>(hash === "#profile-strengthen" ? "tier2" : "tier1");

  return (
    <Section id="profile-facts" labelledBy="profile-facts-heading">
      <SectionHead
        headingId="profile-facts-heading"
        intro={facts.intro}
        title={
          <>
            {facts.titlePlain} <span className="italic">{facts.titleItalic}</span>
          </>
        }
      />
      <div
        aria-label={facts.tiersLabel}
        className="mt-[18px] flex flex-wrap gap-2 max-[767px]:mx-[-16px] max-[767px]:overflow-x-auto max-[767px]:py-[2px] max-[767px]:px-4"
        data-scroll-region
      >
        <FilterChip
          count={facts.tier1.count}
          on={tier === "tier1"}
          onClick={() => {
            setTier("tier1");
          }}
        >
          {facts.tier1.label}
        </FilterChip>
        <FilterChip
          count={facts.tier2.count}
          on={tier === "tier2"}
          onClick={() => {
            setTier("tier2");
          }}
        >
          {facts.tier2.label}
        </FilterChip>
        <FilterChip count={facts.tier3.count} on={false}>
          {facts.tier3.label}
        </FilterChip>
      </div>
      {tier === "tier1" ? (
        <>
          <p className="mt-3 max-w-[62ch] text-[12.5px] text-muted-foreground">
            {facts.tier1.note}
          </p>
          <div className="mt-2">
            {facts.tier1.rows.map((row) => (
              <FactRow
                action={row.action}
                chip={chipForKind(row.chip)}
                key={row.label}
                kind={row.kind}
                label={row.label}
                note={row.note}
                value={row.value}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3.5">
            <p className="text-[12.5px] text-muted-foreground">{facts.tier1.foot}</p>
            <span className="flex flex-wrap gap-2">
              <SourceChip>{facts.fromResume}</SourceChip>
              <SourceChip variant="dashed">{facts.typedHere}</SourceChip>
            </span>
          </div>
        </>
      ) : (
        <div id="profile-strengthen">
          <StrengthenFacts />
          <div className="border-t border-border pt-3.5">
            <p className="text-[12.5px] text-muted-foreground">{facts.strengthen.foot}</p>
          </div>
        </div>
      )}
    </Section>
  );
}
