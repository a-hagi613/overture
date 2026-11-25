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

export function ReviewAnswer({
  field,
  labelledBy = "rev-lbl",
  value,
  onChange,
}: {
  field: AnswerField;
  labelledBy?: string;
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
        {field.options.map((option, index) => {
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
              <span className="min-w-0 truncate">{option}</span>
              <span className="flex shrink-0 items-center gap-2">
                {selected ? (
                  <Check aria-hidden="true" className="text-signal-text" size={14} />
                ) : null}
                {index < 9 ? (
                  <kbd
                    aria-hidden="true"
                    className="hidden rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground sm:inline-block"
                  >
                    {String(index + 1)}
                  </kbd>
                ) : null}
              </span>
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
      ariaLabel={copy.review.yourAnswer}
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
