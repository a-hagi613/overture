import type { LegalBlock } from "../../shared/legal.ts";

export function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.kind === "bullets") {
    return (
      <ul className="ml-[20px] max-w-[66ch] list-disc space-y-[6px] text-[15px] leading-[1.66]">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  if (block.kind === "processors") {
    return (
      <div className="mt-[2px]">
        <div className="hidden grid-cols-[110px_1fr] border-b border-border pb-[10px] font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground sm:grid">
          <span>{block.companyLabel}</span>
          <span>{block.doesLabel}</span>
        </div>
        <dl>
          {block.rows.map((row) => (
            <div
              className="border-b border-border py-[12px] sm:grid sm:grid-cols-[110px_1fr]"
              key={row.name}
            >
              <dt className="text-[14px] font-semibold leading-[1.5] sm:whitespace-nowrap">
                {row.name}
              </dt>
              <dd className="mt-[2px] text-[14px] leading-[1.5] text-muted-foreground sm:mt-0 sm:text-foreground">
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
      <p className="max-w-[66ch] text-[15px] leading-[1.66]">
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

  return <p className="max-w-[66ch] text-[15px] leading-[1.66]">{block.text}</p>;
}
