import type {
  ChangeEventHandler,
  ComponentProps,
  FocusEventHandler,
  KeyboardEventHandler,
} from "react";

import { cn } from "./cn.ts";

export interface InputProps {
  ariaDescribedBy?: string | undefined;
  ariaLabel?: string;
  autoComplete?: string;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  inputMode?: ComponentProps<"input">["inputMode"];
  invalid?: boolean;
  name?: string;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onInput?: ComponentProps<"input">["onInput"];
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  type?: "date" | "email" | "number" | "search" | "tel" | "text" | "time" | "url";
  value?: string;
}

export function Input({
  ariaDescribedBy,
  ariaLabel,
  autoComplete,
  className,
  defaultValue,
  disabled,
  id,
  inputMode,
  invalid = false,
  name,
  onBlur,
  onChange,
  onInput,
  onKeyDown,
  placeholder,
  readOnly,
  required,
  type = "text",
  value,
}: InputProps) {
  return (
    <input
      aria-describedby={ariaDescribedBy}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      autoComplete={autoComplete}
      className={cn(
        "h-12 w-full rounded-md border bg-card px-3.5 text-sm font-medium text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-45",
        invalid ? "border-need ring-1 ring-need" : "border-input",
        className,
      )}
      defaultValue={defaultValue}
      disabled={disabled}
      id={id}
      inputMode={inputMode}
      name={name}
      onBlur={onBlur}
      onChange={onChange}
      onInput={onInput}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      readOnly={readOnly}
      required={required}
      type={type}
      value={value}
    />
  );
}
