import type { ReactNode } from "react";

export function CardHeader({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-3 ${className}`.trim()}>
      {children}
    </div>
  );
}
