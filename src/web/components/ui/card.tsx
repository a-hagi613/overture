import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "./cn.ts";

const cardVariants = cva("rounded-xl border bg-card text-foreground", {
  variants: {
    variant: {
      default: "border-border shadow-sh",
      elevated: "border-input shadow-lift",
      interactive:
        "border-border shadow-sh transition duration-quick ease-out hover:border-input hover:shadow-lift",
      muted: "border-border bg-muted shadow-none",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface CardProps extends VariantProps<typeof cardVariants> {
  ariaBusy?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children: ReactNode;
  className?: string;
  dataTestId?: string;
  id?: string;
}

export function Card({
  ariaBusy,
  ariaLabel,
  ariaLabelledBy,
  children,
  className,
  dataTestId,
  id,
  variant,
}: CardProps) {
  return (
    <section
      aria-busy={ariaBusy}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(cardVariants({ variant }), className)}
      data-testid={dataTestId}
      id={id}
    >
      {children}
    </section>
  );
}
