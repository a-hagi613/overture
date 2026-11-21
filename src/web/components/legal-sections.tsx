import type { LegalBlock, LegalSection } from "../../shared/legal.ts";

import { LegalBlockView } from "./legal-block.tsx";

export function LegalSections({ sections }: { sections: readonly LegalSection[] }) {
  return (
    <div className="mt-[31px] md:mt-[29px]">
      {sections.map((section, index) => (
        <section
          className={
            index === sections.length - 1
              ? "pb-1"
              : "border-b border-border pb-[29px] pt-[42px] first:pb-[30px] first:pt-0 md:pb-[21px] md:pt-[26px] md:first:pb-[30px]"
          }
          key={section.heading}
        >
          <h2 className="font-serif text-[24px] leading-[1.15] tracking-tight md:text-[26px]">
            {section.heading}
          </h2>
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
