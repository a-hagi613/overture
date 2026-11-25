import type { LegalBlock, LegalSection } from "../../shared/legal.ts";

import { LegalBlockView } from "./legal-block.tsx";
import { dsDisplayCardTitle } from "./ui/ds.ts";

export function LegalSections({ sections }: { sections: readonly LegalSection[] }) {
  return (
    <div className="divide-y divide-border">
      {sections.map((section) => (
        <section className="py-6 first:pt-0 last:pb-0" key={section.heading}>
          <h2 className={dsDisplayCardTitle}>{section.heading}</h2>
          <div className="mt-3 space-y-3">
            {section.blocks.map((block: LegalBlock, blockIndex) => (
              <LegalBlockView block={block} key={`${section.heading}-${String(blockIndex)}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
