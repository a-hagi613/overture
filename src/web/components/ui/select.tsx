import { ChevronDown } from "lucide-react";
import type { ChangeEventHandler, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface SelectProps {
  ariaDescribedBy?: string | undefined;
  ariaLabel?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  invalid?: boolean | undefined;
  name?: string | undefined;
  onChange?: ChangeEventHandler<HTMLSelectElement> | undefined;
  selectClassName?: string | undefined;
  value?: string | undefined;
}

/**
 * Reusable native `<select>` wrapper with consistent Overture hairline border and chevron icon.
 * @param props Select container attributes and controlled value props.
 * @param props.ariaDescribedBy Id of the message that explains an invalid choice.
 * @param props.ariaLabel Accessible label when no `<label htmlFor>` is attached.
 * @param props.children Option elements rendered inside the `<select>`.
 * @param props.className Additional classes for the outer relative container.
 * @param props.disabled Disables selection when true.
 * @param props.id HTML id attribute used by `<label htmlFor>` association.
 * @param props.invalid Adds the needs-you border and ring.
 * @param props.name Form field name.
 * @param props.onChange Change handler fired when selection changes.
 * @param props.selectClassName Additional utility classes applied directly to `<select>`.
 * @param props.value Controlled selected option value.
 * @returns Styled select container with trailing dropdown indicator.
 */
export function Select({
  ariaDescribedBy,
  ariaLabel,
  children,
  className,
  disabled,
  id,
  invalid = false,
  name,
  onChange,
  selectClassName,
  value,
}: SelectProps) {
  return (
    <div className={cn("relative", className)}>
      <select
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        className={cn(
          "h-10 w-full cursor-pointer appearance-none rounded-md border bg-card pl-3 pr-9 text-sm font-medium text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-50",
          invalid ? "border-need ring-1 ring-need" : "border-input",
          selectClassName,
        )}
        disabled={disabled}
        id={id}
        name={name}
        onChange={onChange}
        value={value}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        size={15}
      />
    </div>
  );
}
