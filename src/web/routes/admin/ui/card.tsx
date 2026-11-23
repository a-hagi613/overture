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
      className={`rounded-lg border border-border bg-card px-6 py-5 shadow-sh ${className}`.trim()}
    >
      {children}
    </section>
  );
}
