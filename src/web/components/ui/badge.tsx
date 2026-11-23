import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { badgeVariants } from "./badge-variants.ts";
import { cn } from "./cn.ts";

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  ariaHidden?: boolean;
  asChild?: boolean;
  children: ReactNode;
  className?: string;
  title?: string | undefined;
}

const interactiveBadgeClass =
  "cursor-pointer transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2";

export function Badge({
  ariaHidden,
  asChild = false,
  children,
  className,
  size,
  title,
  variant,
}: BadgeProps) {
  const classes = cn(
    badgeVariants({ size, variant }),
    asChild ? interactiveBadgeClass : undefined,
    className,
  );

  if (asChild) {
    return (
      <Slot aria-hidden={ariaHidden} className={classes} title={title}>
        {children}
      </Slot>
    );
  }

  return (
    <span aria-hidden={ariaHidden} className={classes} title={title}>
      {children}
    </span>
  );
}
