import { Badge } from "./ui/badge.tsx";

export function SourceChip(props: { children: string; variant?: "solid" | "dashed" }) {
  const dashed = props.variant === "dashed";

  return (
    <Badge
      className={dashed ? "border-dashed border-muted-foreground text-muted-foreground" : ""}
      variant={dashed ? "outline" : "secondary"}
    >
      {props.children}
    </Badge>
  );
}
