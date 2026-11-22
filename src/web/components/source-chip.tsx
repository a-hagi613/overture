export function SourceChip(props: { children: string; variant?: "solid" | "dashed" }) {
  const dashed = props.variant === "dashed";

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-[9px] py-0.5 text-[11px] font-semibold leading-[normal] ${
        dashed
          ? "border-dashed border-muted-foreground text-muted-foreground"
          : "border-foreground text-foreground"
      }`}
    >
      {props.children}
    </span>
  );
}
