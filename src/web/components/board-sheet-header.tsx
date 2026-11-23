import type { ApplicationDetail } from "../lib/board-api.ts";
import { CompanyAvatar } from "./company-avatar.tsx";

export function BoardSheetHeader({ detail }: { detail: ApplicationDetail }) {
  return (
    <div className="flex items-start gap-3.5">
      <CompanyAvatar
        company={detail.company}
        logoUrl={detail.companyLogoUrl}
        size="lg"
        tone="signal"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-signal-text">{detail.company}</p>
        <h2 className="mt-0.5 font-serif text-page-title leading-tight text-foreground">
          {detail.posting.title}
        </h2>
      </div>
    </div>
  );
}
