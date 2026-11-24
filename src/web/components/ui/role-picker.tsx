import { X } from "lucide-react";
import { useId, useState } from "react";

import { dsEyebrow } from "./ds.ts";

/** One searchable option: the value the query sends and the quiet hint shown beside it. */
export interface RolePickerOption {
  readonly hint?: string;
  readonly value: string;
}

/**
 * A searchable single-select for the ESCO Level-2 role vocabulary (WS-17b). It is a labelled text input backed by a
 * native `<datalist>`, so the browser does the filtering and the control keeps its normal keyboard and screen-reader
 * behaviour. The value commits on Enter or blur only when it matches an option exactly; free text is reverted rather
 * than sent as a role. The clear button is a 44px target on touch.
 * @param props The label, current value, options and change handler.
 * @param props.allowFreeText Whether a typed role that is not in the list is still committed (targets) or reverted (public filters).
 * @param props.className Optional layout class for the wrapper.
 * @param props.clearLabel The accessible name of the clear button.
 * @param props.id The input id, which the label points at.
 * @param props.label The visible label.
 * @param props.onChange Called with the chosen role, or null when cleared.
 * @param props.options The roles and their category hints.
 * @param props.placeholder The input placeholder.
 * @param props.value The chosen role, or null.
 * @returns The labelled combobox input.
 */
export function RolePicker({
  allowFreeText = false,
  className,
  clearLabel,
  id,
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  allowFreeText?: boolean;
  className?: string;
  clearLabel: string;
  id: string;
  label: string;
  onChange: (value: string | null) => void;
  options: readonly RolePickerOption[];
  placeholder: string;
  value: string | null;
}) {
  const listId = `${useId()}-options`;
  const [draft, setDraft] = useState<string | null>(null);

  function commit(raw: string) {
    const trimmed = raw.trim();

    if (trimmed === "") {
      onChange(null);
      setDraft(null);

      return;
    }

    const match = options.find((option) => option.value.toLowerCase() === trimmed.toLowerCase());

    if (match !== undefined) {
      onChange(match.value);
    } else if (allowFreeText) {
      onChange(trimmed);
    }

    setDraft(null);
  }

  const showingDraft = draft ?? value ?? "";

  return (
    <div className={className}>
      <label className={`${dsEyebrow} block`} htmlFor={id}>
        {label}
      </label>
      <div className="relative mt-2">
        <input
          autoComplete="off"
          className="h-12 w-full rounded-md border border-input bg-card pl-3.5 pr-14 text-sm font-medium text-foreground transition placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          id={id}
          list={listId}
          onBlur={(event) => {
            commit(event.currentTarget.value);
          }}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
          placeholder={placeholder}
          type="text"
          value={showingDraft}
        />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.hint}
            </option>
          ))}
        </datalist>
        {showingDraft === "" ? null : (
          <button
            aria-label={clearLabel}
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground md:h-9 md:w-9"
            onClick={() => {
              onChange(null);
              setDraft(null);
            }}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
