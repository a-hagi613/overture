import { Command } from "cmdk";
import { Check } from "lucide-react";

/**
 * Renders one toggleable option row inside MultiSelectCombobox.
 * @param props Option text, active state, and toggle callback.
 * @param props.onToggle Callback invoked when the user clicks or selects the option.
 * @param props.option Option string displayed in the row.
 * @param props.selected Whether this option is currently active.
 * @returns A cmdk item element with a selection indicator.
 */
export function MultiSelectComboboxItem({
  onToggle,
  option,
  selected,
}: {
  onToggle: (value: string) => void;
  option: string;
  selected: boolean;
}) {
  return (
    <Command.Item
      className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-foreground outline-none transition aria-selected:bg-muted data-[selected=true]:bg-muted"
      onSelect={() => {
        onToggle(option);
      }}
      value={option}
    >
      <span className="truncate font-medium">{option}</span>
      {selected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-signal-text" /> : null}
    </Command.Item>
  );
}
