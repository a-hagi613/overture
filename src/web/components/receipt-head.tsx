import type { CompanyBrandKey } from "./landing/company-brands.tsx";
import { CompanyBrandTile } from "./landing/company-brands.tsx";
import { ScoreRing } from "./score-ring.tsx";

export function ReceiptHead({
  brandKey,
  title,
  meta,
}: {
  brandKey: CompanyBrandKey;
  title: string;
  meta: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <CompanyBrandTile brandKey={brandKey} size="md" />
        <div className="min-w-0">
          <h2 className="truncate font-serif text-card-title font-normal text-foreground">
            {title}
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        </div>
      </div>
      <ScoreRing />
    </div>
  );
}
