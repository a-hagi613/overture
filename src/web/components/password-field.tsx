import { copy } from "../../shared/copy.ts";

import { INPUT_CLASS } from "./signin-styles.ts";

export function PasswordField({
  autoComplete = "current-password",
  id,
  onInput,
  show,
  toggle,
  value,
}: {
  autoComplete?: "current-password" | "new-password";
  id: string;
  onInput: (value: string) => void;
  show: boolean;
  toggle: () => void;
  value: string;
}) {
  return (
    <div className="relative">
      <input
        autoComplete={autoComplete}
        className={`${INPUT_CLASS} pr-[84px]`}
        id={id}
        onInput={(event) => {
          onInput(event.currentTarget.value);
        }}
        type={show ? "text" : "password"}
        value={value}
      />
      <button
        aria-label={show ? copy.signIn.hidePassword : copy.signIn.showPassword}
        className="absolute right-1.5 top-1/2 min-h-[34px] max-md:min-h-11 -translate-y-1/2 rounded-md px-2.5 text-[12.5px] font-semibold text-foreground hover:bg-muted"
        onClick={toggle}
        type="button"
      >
        {show ? copy.signIn.hidePassword : copy.signIn.showPassword}
      </button>
    </div>
  );
}
