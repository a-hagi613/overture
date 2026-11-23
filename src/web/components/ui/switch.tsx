import { Root, Thumb } from "@radix-ui/react-switch";

import { cn } from "./cn.ts";

export function Switch({
  ariaLabel,
  checked,
  className,
  disabled,
  id,
  onCheckedChange,
}: {
  ariaLabel?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Root
      aria-label={ariaLabel}
      checked={checked}
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input bg-muted p-0.5 transition-colors data-[state=checked]:border-signal data-[state=checked]:bg-signal disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      disabled={disabled}
      id={id}
      onCheckedChange={onCheckedChange}
    >
      <Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-card shadow-sh transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </Root>
  );
}
