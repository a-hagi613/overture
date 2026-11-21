import { OnboardingSelectField } from "./onboarding-select-field.tsx";

export function OnboardingEeoField({
  disabled,
  id,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  return (
    <div>
      <label className="lbl" htmlFor={id}>
        {label}
      </label>
      <OnboardingSelectField
        ariaLabel={label}
        disabled={disabled}
        id={id}
        onChange={onChange}
        options={options}
        value={value}
      />
    </div>
  );
}
