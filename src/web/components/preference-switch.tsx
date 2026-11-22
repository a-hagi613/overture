export function PreferenceSwitch({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="flex h-11 w-[52px] flex-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed"
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span
        className={`relative inline-flex h-[22px] w-[38px] items-center rounded-full transition-colors ${
          checked ? "bg-foreground" : "bg-muted-foreground"
        }`}
      >
        <span
          className={`absolute top-[3px] h-4 w-4 rounded-full bg-background transition-transform ${
            checked ? "translate-x-[19px]" : "translate-x-[3px]"
          }`}
        />
      </span>
    </button>
  );
}
