import type { ReactNode } from "react";

export function MarketingEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground md:text-[13px]">
      {children}
    </p>
  );
}
