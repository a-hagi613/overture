import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  ghost: "border border-transparent bg-transparent text-foreground hover:bg-muted",
  primary:
    "border border-foreground bg-foreground text-card hover:bg-btn-hover hover:border-btn-hover",
  secondary: "border border-input bg-card text-foreground hover:bg-muted",
};

export function Button({
  ariaControls,
  ariaExpanded,
  ariaLabel,
  ariaPressed,
  children,
  className = "",
  disabled = false,
  onClick,
  variant = "secondary",
}: {
  ariaControls?: string;
  ariaExpanded?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  variant?: ButtonVariant;
}) {
  return (
    <button
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-3.5 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-45 md:min-h-9 ${VARIANT_CLASSES[variant]} ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
