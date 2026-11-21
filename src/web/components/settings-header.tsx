import type { ReactNode } from "react";

import { HeaderControls } from "./header-controls.tsx";

export function SettingsHeader(props: { eyebrow: string; lead: string; titleNode: ReactNode }) {
  const { eyebrow, lead, titleNode } = props;

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div>
        <p className="font-mono text-[11px] uppercase leading-[normal] tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-1.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">{titleNode}</h1>
        <p className="mt-3 font-serif text-[15px] italic text-muted-foreground">{lead}</p>
      </div>
      <HeaderControls running={false} />
    </header>
  );
}
