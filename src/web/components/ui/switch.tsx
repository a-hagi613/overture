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
        "group peer inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition duration-quick ease-out hover:bg-muted hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-45 max-md:h-11 max-md:w-11 md:h-6 md:w-11",
        className,
      )}
      disabled={disabled}
      id={id}
      onCheckedChange={onCheckedChange}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input bg-muted p-0.5 transition-colors group-hover:border-muted-foreground group-data-[state=checked]:border-foreground group-data-[state=checked]:bg-foreground"
      >
        <Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-card shadow-sh transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
      </span>
    </Root>
  );
}
