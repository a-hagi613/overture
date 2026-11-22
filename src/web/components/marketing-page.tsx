import type { ReactNode } from "react";

import { MarketingFooter } from "./marketing-footer.tsx";
import { MarketingHeader } from "./marketing-header.tsx";

export function MarketingPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MarketingHeader />
      <main className="flex-1 outline-none" id="main" tabIndex={-1}>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
