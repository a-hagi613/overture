import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import type { MouseEventHandler, ReactNode } from "react";

import { buttonVariants } from "./button-variants.ts";
import { cn } from "./cn.ts";

export interface ButtonProps extends VariantProps<typeof buttonVariants> {
  ariaBusy?: boolean;
  ariaControls?: string;
  ariaExpanded?: boolean;
  ariaLabel?: string | undefined;
  ariaPressed?: boolean;
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  submit?: boolean;
  title?: string;
}

export function Button({
  ariaBusy,
  ariaControls,
  ariaExpanded,
  ariaLabel,
  ariaPressed,
  asChild = false,
  children,
  className,
  disabled,
  onClick,
  size,
  submit = false,
  title,
  variant,
}: ButtonProps) {
  const classes = cn(buttonVariants({ size, variant }), className);

  if (asChild) {
    return (
      <Slot
        aria-busy={ariaBusy || undefined}
        aria-controls={ariaControls}
        aria-expanded={ariaExpanded}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        className={classes}
        title={title}
      >
        {children}
      </Slot>
    );
  }

  if (submit) {
    return (
      <button
        aria-busy={ariaBusy || undefined}
        aria-controls={ariaControls}
        aria-expanded={ariaExpanded}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        className={classes}
        disabled={disabled}
        onClick={onClick}
        title={title}
        type="submit"
      >
        {children}
      </button>
    );
  }

  return (
    <button
      aria-busy={ariaBusy || undefined}
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
