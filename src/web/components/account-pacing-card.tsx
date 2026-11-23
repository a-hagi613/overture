import { copy } from "../../shared/copy.ts";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

const PACING_LIMITS = [
  { detail: copy.settings.limitDailyDetail, label: copy.settings.limitDaily },
  { detail: copy.settings.limitWindowDetail, label: copy.settings.limitWindow },
  { detail: copy.settings.limitCompanyDetail, label: copy.settings.limitCompany },
  { detail: copy.settings.limitRepostDetail, label: copy.settings.limitRepost },
] as const;

export function AccountPacingCard() {
  return (
    <Card ariaLabelledBy="account-limits" className="p-5 md:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className={dsCardTitle} id="account-limits">
          {`${copy.settings.limitsHeadingPlain} ${copy.settings.limitsHeadingItalic}`}
        </h2>
        <p className="text-xs text-muted-foreground">{copy.settings.limitsFixed}</p>
      </div>
      <p className={`${dsBody} mt-1 text-xs`}>{copy.settings.limitsIntro}</p>
      <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
        {PACING_LIMITS.map((row) => (
          <div className="min-w-0" key={row.label}>
            <p className="text-sm font-semibold text-foreground">{row.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
