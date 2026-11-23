import { useContext } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "./cn.ts";
import { SegmentedControlContext } from "./segmented-control-context.ts";

const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"]);

function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  if (!NAVIGATION_KEYS.has(event.key)) {
    return;
  }

  const items = [
    ...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      "[data-segment]:not(:disabled)",
    ) ?? []),
  ];

  const current = items.indexOf(event.currentTarget);

  if (current === -1) {
    return;
  }

  event.preventDefault();

  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;

  let next: number;

  if (event.key === "Home") {
    next = 0;
  } else if (event.key === "End") {
    next = items.length - 1;
  } else {
    next = (current + step + items.length) % items.length;
  }

  const target = items[next];

  target?.focus();
  target?.click();
}

export function SegmentedControlItem({
  children,
  className,
  disabled,
  value,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  value: string;
}) {
  const control = useContext(SegmentedControlContext);
  const selected = control?.value === value;

  return (
    <button
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-8 max-md:min-h-11 max-md:min-w-11 cursor-pointer items-center justify-center rounded-md px-3 text-xs font-semibold text-muted-foreground transition duration-quick ease-out hover:bg-card/60 hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sh disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      data-segment
      data-state={selected ? "on" : "off"}
      disabled={disabled}
      onClick={() => {
        control?.onValueChange(value);
      }}
      onKeyDown={handleKeyDown}
      tabIndex={selected ? 0 : -1}
      type="button"
    >
      {children}
    </button>
  );
}
