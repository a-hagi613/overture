import { ExternalLink } from "lucide-react";

import { copy } from "../../shared/copy.ts";

export function ApplyRecovery(props: { applyUrl: string | null; company: string }) {
  const { applyUrl, company } = props;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-xs text-muted-foreground">{copy.recovery.nothingSent}</p>
      {applyUrl === null ? null : (
        <a
          aria-label={copy.recovery.applyAria(company)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-foreground underline underline-offset-4 transition hover:opacity-80 max-md:min-h-11"
          href={applyUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span>{copy.recovery.applyOnSite}</span>
          <ExternalLink aria-hidden="true" size={12} />
        </a>
      )}
    </div>
  );
}
