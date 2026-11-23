import { Button } from "../../components/ui/button.tsx";

export function ReadinessPresetRow({
  ariaFor,
  current,
  disabled,
  label,
  onSelect,
  presets,
  valueText,
}: {
  ariaFor: (value: number) => string;
  current: number;
  disabled: boolean;
  label: string;
  onSelect: (value: number) => void;
  presets: readonly number[];
  valueText: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold">{label}</p>
        <p className="font-mono text-[12px] text-muted-foreground tabular-nums">{valueText}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => (
          <Button
            ariaLabel={ariaFor(preset)}
            ariaPressed={current === preset}
            className="min-w-11 px-2.5 font-mono text-[12.5px] md:min-w-9"
            disabled={disabled}
            key={preset}
            onClick={() => {
              onSelect(preset);
            }}
            variant={current === preset ? "primary" : "secondary"}
          >
            {String(preset)}
          </Button>
        ))}
      </div>
    </div>
  );
}
