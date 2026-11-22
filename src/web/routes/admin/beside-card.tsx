import { copy } from "../../../shared/copy.ts";
import type { MarginReport } from "../../lib/admin-api.ts";
import { formatUsd } from "./margin-format.ts";

export function BesideCard({ report }: { report: MarginReport }) {
  const { beside } = report;

  return (
    <section
      aria-labelledby="margin-beside"
      className="mt-6 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
    >
      <h2 id="margin-beside" className="font-serif text-[22px] leading-tight">
        {copy.admin.marginBesideHeading}
      </h2>
      <p className="mt-2 text-[13.5px] text-muted-foreground">{copy.admin.marginBesideBody}</p>
      <dl className="mt-4 grid gap-3 text-[14px] sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{copy.admin.marginBesideInfra}</dt>
          <dd className="tabular-nums">{formatUsd(beside.fixedInfraMicrosPerMonth, 2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy.admin.marginBesideMail}</dt>
          <dd className="tabular-nums">
            {copy.admin.marginBesideMailOverage(beside.mail.sends, beside.mail.includedSends)}
            {beside.mail.overageMicros > 0 ? `, ${formatUsd(beside.mail.overageMicros, 2)}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy.admin.marginBesideOther}</dt>
          <dd className="tabular-nums">{formatUsd(beside.otherAnthropicMicros, 2)}</dd>
        </div>
      </dl>
    </section>
  );
}
