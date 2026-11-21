import type { ReactNode } from "react";

export function AdminAccountItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-border py-3 first:border-t-0 md:grid md:grid-cols-[150px_1fr] md:gap-4">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px] md:mt-0">{children}</dd>
    </div>
  );
}
