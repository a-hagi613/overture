import type { ReactNode } from "react";

export function OnboardingFilterStep({
  children,
  position,
}: {
  children: ReactNode;
  position: number;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-input bg-background font-mono text-xs font-semibold text-foreground"
      >
        {String(position)}
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed text-foreground">
        {children}
      </div>
    </li>
  );
}
