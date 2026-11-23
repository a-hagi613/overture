import type { ReactNode } from "react";

export function Card({
  ariaLabelledBy,
  children,
  className = "",
}: {
  ariaLabelledBy?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={ariaLabelledBy}
      className={`rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh ${className}`.trim()}
    >
      {children}
    </section>
  );
}
