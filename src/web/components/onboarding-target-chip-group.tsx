import type { ReactNode } from "react";

export function OnboardingTargetChipGroup(props: {
  children: ReactNode;
  headingId: string;
  label: string;
  note?: string;
}) {
  return (
    <div>
      <h3 className="lbl flat" id={props.headingId}>
        {props.label}
        {props.note === undefined ? null : <span className="req">{props.note}</span>}
      </h3>
      <fieldset aria-labelledby={props.headingId} className="chipsx m-0 min-w-0 border-0 p-0">
        {props.children}
      </fieldset>
    </div>
  );
}
