import type { ReactNode } from "react";

export function PageNote({ tone, children }: { tone: "need" | "muted"; children: ReactNode }) {
  const tones = {
    need: "border-need-soft bg-need-soft text-foreground",
    muted: "border-border bg-muted text-muted-foreground",
  } as const;

  return (
    <div className={`mt-5 rounded-md border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}
