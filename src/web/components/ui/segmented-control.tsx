import { useMemo, useRef } from "react";
import type { ReactNode } from "react";

import { cn } from "./cn.ts";
import { SegmentedControlContext } from "./segmented-control-context.ts";

export function SegmentedControl({
  ariaLabel,
  children,
  className,
  onValueChange,
  value,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const context = useMemo(() => ({ groupRef, onValueChange, value }), [onValueChange, value]);

  return (
    <fieldset
      aria-label={ariaLabel}
      className={cn(
        "m-0 inline-flex min-w-0 items-center gap-1 rounded-lg border border-border bg-muted p-1 text-muted-foreground",
        className,
      )}
      ref={groupRef}
    >
      <SegmentedControlContext.Provider value={context}>
        {children}
      </SegmentedControlContext.Provider>
    </fieldset>
  );
}
