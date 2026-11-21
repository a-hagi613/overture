export function OnboardingTargetChip(props: {
  children: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={props.on}
      className={`cpx${props.on ? " on" : ""}`}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}
