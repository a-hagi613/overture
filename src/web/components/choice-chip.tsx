import type { ReactNode } from "react";

export function ChoiceChip(props: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="inline-flex min-h-9 items-center gap-0.5 rounded-full border border-input bg-card py-0 pl-[13px] pr-1 text-[13px] font-semibold leading-[normal] max-[767px]:min-h-11">
      {props.children}
      {props.removeLabel === undefined ? null : (
        <button
          aria-label={props.removeLabel}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground max-[767px]:h-9 max-[767px]:w-9"
          onClick={props.onRemove}
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
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </span>
  );
}
