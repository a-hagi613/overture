import { Command } from "cmdk";
import { Check } from "lucide-react";

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly meta?: string | undefined;
}

/**
 * Renders one selectable row inside the shared Combobox popover menu.
 * @param props Option data, selection state, and click handler.
 * @param props.isSelected Whether this option matches the current value.
 * @param props.onSelectValue Callback invoked with the selected option value.
 * @param props.option Option metadata displayed in the list row.
 * @returns A cmdk item element.
 */
export function ComboboxOptionItem({
  isSelected,
  onSelectValue,
  option,
}: {
  isSelected: boolean;
  onSelectValue: (value: string) => void;
  option: ComboboxOption;
}) {
  return (
    <Command.Item
      className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-foreground outline-none transition aria-selected:bg-muted data-[selected=true]:bg-muted"
      onSelect={() => {
        onSelectValue(option.value);
      }}
      value={`${option.label} ${option.meta ?? ""}`}
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate font-medium">{option.label}</span>
        {option.meta === undefined || option.meta === "" ? null : (
          <span className="block truncate text-xs text-muted-foreground">{option.meta}</span>
        )}
      </div>
      {isSelected ? (
        <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-signal-text" />
      ) : null}
    </Command.Item>
  );
}
