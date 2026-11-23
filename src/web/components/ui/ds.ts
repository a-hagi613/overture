import { buttonVariants } from "./button-variants.ts";

export const dsContainer = "mx-auto max-w-[1200px] px-5 sm:px-8 lg:px-12 2xl:max-w-[1440px]";

export const dsCard = "rounded-xl border border-border bg-card shadow-sh";

export const dsEyebrow = "text-eyebrow font-semibold uppercase text-muted-foreground";

export const dsSectionHeading = "font-serif text-section font-normal text-balance text-foreground";

export const dsPageTitle = "font-serif text-page-title font-normal leading-tight text-foreground";

export const dsBandHeading = "font-serif text-section font-normal text-balance";

export const dsCardTitle = "font-serif text-card-title font-normal text-foreground";

export const dsMetric = "font-serif text-metric font-normal tabular-nums text-foreground";

export const dsBody = "text-sm leading-relaxed text-muted-foreground text-pretty";

export const dsLead = "text-base leading-relaxed text-muted-foreground text-pretty";

export const dsMono = "font-mono text-xs tabular-nums text-muted-foreground";

export const dsBtnPrimary = buttonVariants({ size: "default", variant: "primary" });

export const dsBtnPrimaryLg = buttonVariants({ size: "lg", variant: "primary" });

export const dsBtnPrimaryXs = buttonVariants({ size: "sm", variant: "primary" });

export const dsBtnSecondary = buttonVariants({ size: "default", variant: "secondary" });

export const dsBtnSecondaryLg = buttonVariants({ size: "lg", variant: "secondary" });

export const dsIconBtn = buttonVariants({ size: "iconLg", variant: "outline" });

export const dsNavLink =
  "whitespace-nowrap py-2 text-sm font-medium text-muted-foreground transition duration-quick ease-out hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center";
