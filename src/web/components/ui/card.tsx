import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "./cn.ts";

const cardVariants = cva("rounded-xl border bg-card text-foreground", {
  variants: {
    variant: {
      default: "border-border",
      elevated: "border-border shadow-sh",
      interactive:
        "border-border transition duration-quick ease-out hover:border-input hover:bg-muted/30",
      muted: "border-border bg-muted",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface CardProps extends VariantProps<typeof cardVariants> {
  ariaBusy?: boolean | undefined;
  ariaLabel?: string | undefined;
  ariaLabelledBy?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  dataTestId?: string | undefined;
  id?: string | undefined;
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
