import { Button } from "./ui/button.tsx";

export function ReadinessPresetRow({
  ariaFor,
  current,
  disabled,
  label,
  labelFor,
  onSelect,
  presets,
  valueText,
}: {
  ariaFor: (value: number) => string;
  current: number;
  disabled: boolean;
  label: string;
  labelFor?: (value: number) => string;
  onSelect: (value: number) => void;
  presets: readonly number[];
  valueText: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">{valueText}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => (
          <Button
            ariaLabel={ariaFor(preset)}
            ariaPressed={current === preset}
            className="min-w-11 px-2.5 font-mono text-xs md:min-w-9"
            disabled={disabled}
            key={preset}
            onClick={() => {
              onSelect(preset);
            }}
            variant={current === preset ? "primary" : "secondary"}
          >
            {labelFor === undefined ? String(preset) : labelFor(preset)}
          </Button>
        ))}
      </div>
    </div>
  );
}
