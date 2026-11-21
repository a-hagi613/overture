import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Section } from "./section.tsx";
import { SectionHead } from "./section-head.tsx";
import { SourceChip } from "./source-chip.tsx";

export function AddressSection() {
  const { address } = copy.profile;

  return (
    <Section id="profile-address" labelledBy="profile-address-heading">
      <SectionHead
        headingId="profile-address-heading"
        intro={address.intro}
        title={
          <>
            {address.titlePlain} <span className="italic">{address.titleItalic}</span>
          </>
        }
      />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-lg border border-border bg-muted p-[18px] px-5">
        <p className="font-mono text-[17px] [overflow-wrap:anywhere]">{address.alias}</p>
        <SourceChip variant="dashed">{address.chip}</SourceChip>
      </div>
      <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-x-5">
        <div className="border-t border-border py-3">
          <dt className="text-[11px] leading-[normal] font-semibold uppercase tracking-[.15em] text-muted-foreground">
            {address.onEveryForm}
          </dt>
          <dd className="mt-1 text-sm leading-[1.5] font-semibold">{address.onEveryFormValue}</dd>
        </div>
        <div className="border-t border-border py-3">
          <dt className="text-[11px] leading-[normal] font-semibold uppercase tracking-[.15em] text-muted-foreground">
            {address.repliesTo}
          </dt>
          <dd className="mt-1 text-sm leading-[1.5] font-semibold">
            <Link className="border-b border-input" to="/inbox">
              {address.repliesToValue}
            </Link>
          </dd>
        </div>
      </dl>
      <p className="mt-1.5 max-w-[62ch] text-[12.5px] text-muted-foreground">
        {address.changeNote}
      </p>
    </Section>
  );
}
