import type { Review } from "../lib/review-api";

import { copy } from "../../shared/copy.ts";
import { OPTION_FIELD_TYPES } from "../../shared/questions.ts";

function isOptionField(type: Review["fieldType"]) {
  return OPTION_FIELD_TYPES.some((candidate) => candidate === type);
}

function inputType(type: Review["fieldType"]) {
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
  review,
  value,
  onChange,
}: {
  review: Review;
  value: string;
  onChange: (value: string) => void;
}) {
  if (isOptionField(review.fieldType) && review.options.length > 0) {
    const multiple = review.fieldType === "multiselect";
    const chosen = multiple ? value.split(", ").filter((part) => part !== "") : [value];

    return (
      <fieldset aria-labelledby="rev-lbl" className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
        {review.options.map((option) => {
          const selected = chosen.includes(option);

          return (
            <button
              aria-pressed={selected}
              className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-full border px-[14px] text-[13px] font-semibold ${
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-input bg-card text-foreground hover:bg-muted"
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
              {option}
            </button>
          );
        })}
      </fieldset>
    );
  }

  if (review.fieldType === "checkbox") {
    return (
      <label className="flex min-h-11 items-center gap-3 text-[13.5px] font-semibold">
        <input
          checked={value === "Yes"}
          className="h-5 w-5 rounded-[5px] border-input accent-foreground"
          onChange={(event) => {
            onChange(event.target.checked ? "Yes" : "");
          }}
          type="checkbox"
        />
        {copy.review.checkboxYes}
      </label>
    );
  }

  if (review.fieldType === "textarea") {
    return (
      <textarea
        aria-labelledby="rev-lbl"
        className="min-h-24 w-full rounded-md border border-input bg-card p-3 text-[13.5px] text-foreground placeholder:text-muted-foreground"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={copy.review.answerPlaceholder}
        value={value}
      />
    );
  }

  return (
    <input
      aria-labelledby="rev-lbl"
      className="h-10 w-full rounded-md border border-input bg-card px-3 text-[13.5px] font-medium text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      placeholder={copy.review.answerPlaceholder}
      type={inputType(review.fieldType)}
      value={value}
    />
  );
}
