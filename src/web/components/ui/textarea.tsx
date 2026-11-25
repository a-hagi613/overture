import type { ChangeEventHandler } from "react";

import { cn } from "./cn.ts";

export interface TextareaProps {
  ariaDescribedBy?: string | undefined;
  ariaLabel?: string | undefined;
  ariaLabelledBy?: string | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  invalid?: boolean | undefined;
  name?: string | undefined;
  onChange?: ChangeEventHandler<HTMLTextAreaElement> | undefined;
  placeholder?: string | undefined;
  readOnly?: boolean | undefined;
  required?: boolean | undefined;
  rows?: number | undefined;
  value?: string | undefined;
}

/**
 * Reusable multiline text input styled with Overture design tokens and focus rings.
 * @param props Standard controlled textarea attributes and optional validation state.
 * @param props.ariaDescribedBy ID of element describing this field or its error.
 * @param props.ariaLabel Accessible label when no visible label element is linked.
 * @param props.ariaLabelledBy ID of external labelling element.
 * @param props.className Additional utility classes merged onto the textarea element.
 * @param props.disabled Whether the textarea is disabled.
 * @param props.id HTML id attribute for label association.
 * @param props.invalid Highlights border with error ring when true.
 * @param props.name Form field name.
 * @param props.onChange Change handler invoked with textarea changes.
 * @param props.placeholder Placeholder copy when empty.
 * @param props.readOnly Prevents user edits when true.
 * @param props.required Marks field required on form submission.
 * @param props.rows Initial visible row height.
 * @param props.value Controlled value.
 * @returns Styled `<textarea>` element.
 */
export function Textarea({
  ariaDescribedBy,
  ariaLabel,
  ariaLabelledBy,
  className,
  disabled,
  id,
  invalid = false,
  name,
  onChange,
  placeholder,
  readOnly,
  required,
  rows,
  value,
}: TextareaProps) {
  return (
    <textarea
      aria-describedby={ariaDescribedBy}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(
        "w-full rounded-md border bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-45",
        invalid ? "border-need ring-1 ring-need" : "border-input",
        className,
      )}
      disabled={disabled}
      id={id}
      name={name}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      required={required}
      rows={rows}
      value={value}
    />
  );
}
