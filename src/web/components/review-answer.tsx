import type { QuestionFieldType } from "../../shared/questions";

import { copy } from "../../shared/copy.ts";
import { OPTION_FIELD_TYPES } from "../../shared/questions.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

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
        className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
      >
        {field.options.map((option) => {
          const selected = chosen.includes(option);

          return (
            <Button
              ariaPressed={selected}
              className="rounded-full"
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
              size="sm"
              variant={selected ? "primary" : "outline"}
            >
              {option}
            </Button>
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
      <textarea
        aria-labelledby={labelledBy}
        className="min-h-24 w-full rounded-md border border-input bg-card p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
      onChange={(event) => {
        onChange(event.target.value);
      }}
      placeholder={copy.review.answerPlaceholder}
      type={inputType(field.fieldType)}
      value={value}
    />
  );
}
