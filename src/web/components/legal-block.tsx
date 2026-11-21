import type { LegalBlock } from "../../shared/legal.ts";

export function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.kind === "bullets") {
    return (
      <ul className="ml-[18px] list-disc space-y-[7px] text-[15px] leading-[1.7] md:leading-[1.6]">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  if (block.kind === "processors") {
    return (
      <div>
        <div className="mt-[18px] hidden grid-cols-[110px_1fr] border-b border-border pb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground sm:grid">
          <span>{block.companyLabel}</span>
          <span>{block.doesLabel}</span>
        </div>
        <dl>
          {block.rows.map((row) => (
            <div
              className="border-b border-border py-[13px] sm:grid sm:grid-cols-[110px_1fr] sm:py-[11px]"
              key={row.name}
            >
              <dt className="text-[13.5px] font-semibold leading-[1.5] sm:font-normal">
                {row.name}
              </dt>
              <dd className="mt-0.5 text-[13.5px] leading-[1.55] text-muted-foreground sm:mt-0 sm:text-foreground">
                {row.does}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  if (block.kind === "paragraphWithLink") {
    return (
      <p className="text-[15px] leading-[1.7] md:leading-[1.6]">
        {block.before}
        <a
          className="underline decoration-input underline-offset-[3px] transition-colors hover:decoration-foreground"
          href={block.href}
        >
          {block.link}
        </a>
        {block.after}
      </p>
    );
  }

  return <p className="text-[15px] leading-[1.7] md:leading-[1.6]">{block.text}</p>;
}
