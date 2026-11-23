import { ChevronDown } from "lucide-react";

export function OnboardingSelectField({
  ariaLabel,
  disabled = false,
  id,
  onChange,
  options,
  placeholder,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  id: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  value: string;
}) {
  return (
    <div className="relative w-full">
      <select
        aria-label={ariaLabel}
        className="h-10 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pl-3 pr-9 text-sm text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        id={id}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        value={value}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        size={15}
      />
    </div>
  );
}
