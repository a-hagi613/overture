import { Button } from "./ui/button.tsx";

export function OnboardingTargetChip(props: {
  children: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      ariaPressed={props.on}
      className="rounded-full"
      onClick={props.onClick}
      size="sm"
      variant={props.on ? "primary" : "outline"}
    >
      {props.children}
    </Button>
  );
}
