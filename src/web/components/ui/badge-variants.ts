import { cva } from "class-variance-authority";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 border font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-foreground bg-foreground text-primary-ink",
        secondary: "border-border bg-muted text-foreground",
        signal: "border-signal/35 bg-signal-soft text-signal-text",
        ok: "border-transparent bg-ok-soft text-ok",
        need: "border-transparent bg-need-soft text-need",
        outline: "border-input bg-card text-muted-foreground",
      },
      size: {
        sm: "rounded-md px-2 py-0.5 text-xs",
        eyebrow: "rounded-full px-3 py-1 text-eyebrow uppercase",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "sm",
    },
  },
);
