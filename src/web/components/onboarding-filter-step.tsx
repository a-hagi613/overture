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
        className="mono flex size-[26px] flex-none items-center justify-center rounded-full border-[1.5px] border-input text-[12px]"
      >
        {position}
      </span>
      <div className="min-w-0 flex-1 pt-[3px] text-[14px]">{children}</div>
    </li>
  );
}
