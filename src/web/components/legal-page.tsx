import type { LegalSection } from "../../shared/legal.ts";

import { copy } from "../../shared/copy.ts";
import { LegalSections } from "./legal-sections.tsx";
import { LegalShell } from "./legal-shell.tsx";

export function LegalPage({
  sections,
  title,
}: {
  sections: readonly LegalSection[];
  title: string;
}) {
  return (
    <LegalShell>
      <p className="mt-[22px] font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {copy.legal.eyebrow}
      </p>
      <h1 className="mt-[18px] font-serif text-[40px] leading-[1.02] tracking-[-0.018em] md:text-[58px]">
        {title}
      </h1>
      <p className="mt-[20px] text-[13px] leading-[1.5] text-muted-foreground md:mt-[19px]">
        {copy.legal.lastUpdated}
        {copy.legal.metaSeparator}
        {copy.legal.effective}
      </p>
      <LegalSections sections={sections} />
    </LegalShell>
  );
}
