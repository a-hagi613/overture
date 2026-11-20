export function AddChip(props: { children: string; onClick?: () => void }) {
  return (
    <button
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-input px-3.5 text-[13px] font-semibold leading-[normal] text-muted-foreground hover:bg-muted hover:text-foreground max-[767px]:min-h-11"
      onClick={props.onClick}
      type="button"
    >
      <svg
        aria-hidden="true"
        fill="none"
        height="14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
        width="14"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      {props.children}
    </button>
  );
}
