import type { ConsentVersion } from "../../shared/consent.ts";

import { copy } from "../../shared/copy.ts";
import { longDate } from "../lib/consent-format.ts";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsEyebrow } from "./ui/ds.ts";

export function ConsentEarlierVersions({ versions }: { versions: readonly ConsentVersion[] }) {
  return (
    <Card ariaLabelledBy="earlier-versions" className="mt-6 p-6">
      <h2 className={dsCardTitle} id="earlier-versions">
        {copy.consent.earlierHeading}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{copy.consent.earlierNote}</p>
      <dl className="mt-4 divide-y divide-border">
        {versions.map((version) => (
          <div className="py-4 first:pt-0 last:pb-0" key={version.version}>
            <dt className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={dsEyebrow}>{copy.consent.versionLabel(version.version)}</span>
              <span className="text-xs text-muted-foreground">
                {copy.consent.publishedOn(longDate(version.publishedAt))}
              </span>
            </dt>
            <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{version.text}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
