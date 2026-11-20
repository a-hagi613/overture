export function FilterChip(props: {
  ariaLabel?: string;
  children: string;
  count?: string;
  on: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={props.ariaLabel}
      aria-pressed={props.on}
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] leading-[normal] font-semibold max-[767px]:min-h-11 ${
        props.on
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-card text-foreground hover:bg-muted"
      }`}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
      {props.count === undefined ? null : (
        <b className="text-[11.5px] font-bold opacity-[.78] tabular-nums">{props.count}</b>
      )}
    </button>
  );
}
