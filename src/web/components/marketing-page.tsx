import type { ReactNode } from "react";

import { MarketingFooter } from "./marketing-footer.tsx";
import { MarketingHeader } from "./marketing-header.tsx";

export function MarketingPage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-dvh flex-col bg-background text-foreground ${className}`}>
      <MarketingHeader />
      <main className="flex-1 outline-none" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
