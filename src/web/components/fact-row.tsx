import type { ReactNode } from "react";

import { copy } from "../../shared/copy.ts";

export function FactRow(props: {
  action: "edit" | "read-only";
  chip: ReactNode;
  kind?: "mono" | "serif";
  label: string;
  note: string;
  value: string;
}) {
  const actionText =
    props.action === "read-only" ? copy.profile.facts.readOnly : copy.profile.facts.edit;

  const actionAria = copy.profile.facts.aria(props.label, actionText);

  return (
    <div className="flex flex-wrap items-center gap-x-5 border-t border-border py-4">
      <div className="min-w-0 flex-[1_1_340px]">
        <p className="text-sm font-semibold leading-[1.4]">{props.label}</p>
        <p
          className={
            props.kind === "mono"
              ? "break-words font-mono text-sm leading-[1.5]"
              : "font-serif text-[22px] leading-[1.2]"
          }
        >
          {props.value}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {props.chip}
          <span className="text-[12.5px] text-muted-foreground tabular-nums">{props.note}</span>
        </div>
      </div>
      <button
        aria-label={actionAria}
        className="min-h-10 flex-none px-3.5 text-[13.5px] leading-[normal] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground max-[767px]:min-h-11"
        type="button"
      >
        {actionText}
      </button>
    </div>
  );
}
