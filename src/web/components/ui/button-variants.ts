import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition duration-quick ease-out disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "border border-foreground bg-foreground text-primary-ink shadow-sh hover:-translate-y-px hover:border-btn-hover hover:bg-btn-hover",
        secondary:
          "border border-input bg-card text-foreground shadow-sh hover:-translate-y-px hover:border-foreground/30 hover:bg-muted hover:text-foreground",
        outline: "border border-input bg-transparent text-foreground hover:bg-muted",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "border border-need bg-need text-primary-ink shadow-sh hover:-translate-y-px hover:border-need/85 hover:bg-need/85",
        link: "border-0 bg-transparent px-0 max-md:min-h-11 text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground",
      },
      size: {
        xs: "min-h-8 max-md:min-h-11 px-3 text-xs",
        sm: "min-h-9 max-md:min-h-11 px-3.5 text-xs",
        default: "min-h-11 px-5 text-sm",
        lg: "min-h-12 px-6 text-sm sm:min-h-13 sm:px-7 sm:text-base",
        icon: "h-10 w-10 max-md:h-11 max-md:w-11 p-0",
        iconLg: "h-11 w-11 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);
