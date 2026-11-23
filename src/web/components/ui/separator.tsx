import { Root } from "@radix-ui/react-separator";

import { cn } from "./cn.ts";

export function Separator({
  className,
  decorative = true,
  orientation = "horizontal",
}: {
  className?: string;
  decorative?: boolean;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <Root
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      decorative={decorative}
      orientation={orientation}
    />
  );
}
