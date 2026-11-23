import type { ReactNode } from "react";

import { dsEyebrow } from "./ui/ds.ts";

export function OnboardingTargetChipGroup(props: {
  children: ReactNode;
  headingId: string;
  label: string;
  note?: string;
}) {
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
        <h3 className={dsEyebrow} id={props.headingId}>
          {props.label}
        </h3>
        {props.note === undefined ? null : (
          <span className="text-xs text-muted-foreground">{props.note}</span>
        )}
      </div>
      <fieldset
        aria-labelledby={props.headingId}
        className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
      >
        {props.children}
      </fieldset>
    </div>
  );
}
