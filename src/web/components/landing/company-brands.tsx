import type { CompanyBrandKey } from "./company-brands-data.ts";

import { companyBrands } from "./company-brands-data.ts";

export type { CompanyBrandKey } from "./company-brands-data.ts";

export function CompanyBrandTile({
  brandKey,
  size = "md",
}: {
  brandKey: CompanyBrandKey;
  size?: "sm" | "md";
}) {
  const brand = companyBrands[brandKey];
  const isSm = size === "sm";

  return (
    <span
      aria-hidden="true"
      className={
        isSm
          ? "inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border shadow-sh"
          : "inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-border shadow-sh sm:h-11 sm:w-11"
      }
      style={{ backgroundColor: brand.tileBg }}
    >
      <svg fill={brand.color} height={isSm ? 18 : 22} viewBox="0 0 24 24" width={isSm ? 18 : 22}>
        <path d={brand.path} />
      </svg>
    </span>
  );
}
