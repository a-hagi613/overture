import type { LegalBlock } from "../../shared/legal.ts";

import { dsEyebrow } from "./ui/ds.ts";

export function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.kind === "bullets") {
    return (
      <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  if (block.kind === "processors") {
    return (
      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
        <div
          className={`${dsEyebrow} hidden grid-cols-[140px_1fr] border-b border-border bg-muted px-4 py-2.5 sm:grid`}
        >
          <span>{block.companyLabel}</span>
          <span>{block.doesLabel}</span>
        </div>
        <dl className="divide-y divide-border">
          {block.rows.map((row) => (
            <div className="px-4 py-3 sm:grid sm:grid-cols-[140px_1fr] sm:gap-4" key={row.name}>
              <dt className="text-sm font-semibold text-foreground">{row.name}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground sm:mt-0">
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
      <p className="text-sm leading-relaxed text-foreground">
        {block.before}
        <a
          className="font-medium text-signal-text underline underline-offset-4 hover:opacity-80"
          href={block.href}
        >
          {block.link}
        </a>
        {block.after}
      </p>
    );
  }

  return <p className="text-sm leading-relaxed text-foreground">{block.text}</p>;
}
