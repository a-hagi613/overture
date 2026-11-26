import { Check } from "lucide-react";

import type { QuestionFieldType } from "../../shared/questions";

import { copy } from "../../shared/copy.ts";
import { OPTION_FIELD_TYPES } from "../../shared/questions.ts";
import { Input } from "./ui/input.tsx";
import { Textarea } from "./ui/textarea.tsx";

export interface AnswerField {
  fieldType: QuestionFieldType;
  options: readonly string[];
}

function isOptionField(type: QuestionFieldType) {
  return OPTION_FIELD_TYPES.some((candidate) => candidate === type);
}

function inputType(type: QuestionFieldType) {
  if (type === "number") {
    return "number";
  }

  if (type === "email") {
    return "email";
  }

  if (type === "url") {
    return "url";
  }

  if (type === "date") {
    return "date";
  }

  if (type === "phone") {
    return "tel";
  }

  return "text";
}

/**
 * Renders the interactive control for one Review question. Every field type
 * produces an input: option types get choice tiles, long text gets a textarea,
 * and every other type gets a matching text input.
 * @param props The question shape, its visible label id, accessible name and current value.
 * @param props.field The question's field type and options.
 * @param props.label The question prompt used as the accessible name.
 * @param props.labelledBy The id of the visible question heading.
 * @param props.value The current answer.
 * @param props.onChange Receives the new answer.
 * @returns A fieldset of options, a checkbox, a textarea or a text input.
 */
export function ReviewAnswer({
  field,
  label,
  labelledBy,
  value,
  onChange,
}: {
  field: AnswerField;
  label: string;
  labelledBy: string;
  value: string;
  onChange: (value: string) => void;
}) {
  if (isOptionField(field.fieldType) && field.options.length > 0) {
    const multiple = field.fieldType === "multiselect";
    const chosen = multiple ? value.split(", ").filter((part) => part !== "") : [value];

    return (
      <fieldset
        aria-labelledby={labelledBy}
        className="m-0 grid min-w-0 grid-cols-1 gap-2 border-0 p-0 sm:grid-cols-2"
      >
        {field.options.map((option) => {
          const selected = chosen.includes(option);

          return (
            <button
              aria-pressed={selected}
              className={`flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-md border px-4 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                selected
                  ? "border-foreground bg-muted font-semibold text-foreground"
                  : "border-border bg-card font-medium text-foreground hover:bg-muted/60"
              }`}
              key={option}
              onClick={() => {
                if (!multiple) {
                  onChange(option);

                  return;
                }

                const next = selected
                  ? chosen.filter((part) => part !== option)
                  : [...chosen, option];

                onChange(next.join(", "));
              }}
              type="button"
            >
              <span className="min-w-0 break-words">{option}</span>
              {selected ? (
                <Check aria-hidden="true" className="shrink-0 text-signal-text" size={14} />
              ) : null}
            </button>
          );
        })}
      </fieldset>
    );
  }

  if (field.fieldType === "checkbox") {
    return (
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-foreground">
        <input
          aria-label={`${label}: ${copy.review.checkboxYes}`}
          checked={value === "Yes"}
          className="h-5 w-5 rounded border-input accent-signal"
          onChange={(event) => {
            onChange(event.target.checked ? "Yes" : "");
          }}
          type="checkbox"
        />
        {copy.review.checkboxYes}
      </label>
    );
  }

  if (field.fieldType === "textarea") {
    return (
      <Textarea
        ariaLabelledBy={labelledBy}
        className="min-h-32 p-3.5"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={copy.review.answerPlaceholder}
        value={value}
      />
    );
  }

  return (
    <Input
      ariaLabel={label}
      className="h-12 text-sm"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      placeholder={copy.review.answerPlaceholder}
      type={inputType(field.fieldType)}
      value={value}
    />
  );
}
