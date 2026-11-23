import type { ReactNode } from "react";

export function AdminAccountItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-border py-3 first:border-t-0 md:grid md:grid-cols-[150px_1fr] md:gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-sm md:mt-0">{children}</dd>
    </div>
  );
}
