import type { ConsentVersion } from "../../shared/consent.ts";

import { copy } from "../../shared/copy.ts";
import { longDate } from "../lib/consent-format.ts";

export function ConsentEarlierVersions({ versions }: { versions: readonly ConsentVersion[] }) {
  return (
    <section aria-labelledby="earlier-versions" className="mt-[30px]">
      <h2 className="font-serif text-[26px] leading-[1.15]" id="earlier-versions">
        {copy.consent.earlierHeading}
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.consent.earlierNote}</p>
      <dl className="mt-3">
        {versions.map((version) => (
          <div className="border-t border-border py-3" key={version.version}>
            <dt className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em]">
                {copy.consent.versionLabel(version.version)}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {copy.consent.publishedOn(longDate(version.publishedAt))}
              </span>
            </dt>
            <dd className="mt-2 text-[13.5px] leading-[1.6] text-muted-foreground">
              {version.text}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
