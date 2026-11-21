import type { ReactNode } from "react";

import { HeaderControls } from "./header-controls.tsx";

export function PageHeader({ lead, titleNode }: { lead: string; titleNode: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div>
        <p className="font-serif text-[15px] italic text-muted-foreground">{lead}</p>
        <h1 className="mt-0.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">{titleNode}</h1>
      </div>
      <HeaderControls running />
    </header>
  );
}
