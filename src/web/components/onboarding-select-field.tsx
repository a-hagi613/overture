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
    <div className="fld">
      <select
        aria-label={ariaLabel}
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
      <svg
        aria-hidden="true"
        fill="none"
        height={16}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        viewBox="0 0 24 24"
        width={16}
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}
