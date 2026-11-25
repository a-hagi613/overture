import type { LegalSection } from "../../shared/legal.ts";

import { copy } from "../../shared/copy.ts";
import { LegalSections } from "./legal-sections.tsx";
import { LegalShell } from "./legal-shell.tsx";
import { Card } from "./ui/card.tsx";
import { dsDisplayPageTitle, dsEyebrow } from "./ui/ds.ts";

function splitAccentTitle(title: string) {
  const parts = title.trim().split(/\s+/u);

  if (parts.length <= 1) {
    return { accent: title, plain: "" };
  }

  return {
    accent: parts.at(-1) ?? "",
    plain: `${parts.slice(0, -1).join(" ")} `,
  };
}

export function LegalPage({
  sections,
  title,
}: {
  sections: readonly LegalSection[];
  title: string;
}) {
  const { accent, plain } = splitAccentTitle(title);

  return (
    <LegalShell>
      <p className={dsEyebrow}>{copy.legal.eyebrow}</p>
      <h1 className={`${dsDisplayPageTitle} mt-2`}>
        {plain}
        <em className="italic text-signal">{accent}</em>
      </h1>
      <p className="mt-2 text-xs text-muted-foreground">
        {`${copy.legal.lastUpdated}${copy.legal.metaSeparator}${copy.legal.effective}`}
      </p>
      <Card className="mt-6 p-6 md:p-8" variant="default">
        <LegalSections sections={sections} />
      </Card>
    </LegalShell>
  );
}
