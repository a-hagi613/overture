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
      <p className="mt-[12px] font-mono md:mt-[21px] text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
        {copy.legal.eyebrow}
      </p>
      <h1 className="mt-[24px] font-serif text-[39px] md:mt-[13px] leading-[1.02] tracking-tight md:text-[56px]">
        {title}
      </h1>
      <p className="mt-[14px] text-[12.5px] leading-[1.6] text-muted-foreground md:mt-[27px]">
        {copy.legal.lastUpdated}
        {copy.legal.metaSeparator}
        {copy.legal.effective}
      </p>
      <LegalSections sections={sections} />
    </LegalShell>
  );
}
