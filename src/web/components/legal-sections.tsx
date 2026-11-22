import type { LegalBlock, LegalSection } from "../../shared/legal.ts";

import { LegalBlockView } from "./legal-block.tsx";

export function LegalSections({ sections }: { sections: readonly LegalSection[] }) {
  return (
    <div className="mt-[28px] md:mt-[29px]">
      {sections.map((section, index) => (
        <section
          className={index === 0 ? "pb-[22px] pt-[4px]" : "border-t border-border py-[22px]"}
          key={section.heading}
        >
          <h2 className="font-serif text-[26px] leading-[1.15]">{section.heading}</h2>
          <div className="mt-[10px] space-y-[10px]">
            {section.blocks.map((block: LegalBlock, blockIndex) => (
              <LegalBlockView block={block} key={`${section.heading}-${String(blockIndex)}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
