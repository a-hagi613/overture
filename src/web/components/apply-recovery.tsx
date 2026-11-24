import { ExternalLink } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";

export function ApplyRecovery(props: { applyUrl: string | null; company: string }) {
  const { applyUrl, company } = props;

  return (
    <div className="mt-2">
      <p className="text-xs leading-relaxed text-foreground">{copy.recovery.nothingSent}</p>
      {applyUrl === null ? null : (
        <Button asChild className="mt-2" size="sm" variant="secondary">
          <a
            aria-label={copy.recovery.applyAria(company)}
            href={applyUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" size={14} />
            <span>{copy.recovery.applyOnSite}</span>
          </a>
        </Button>
      )}
    </div>
  );
}
