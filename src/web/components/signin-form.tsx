import { copy } from "../../shared/copy.ts";

import { PasswordField } from "./password-field.tsx";
import { BTN_PRIMARY, INPUT_CLASS, LABEL_CLASS } from "./signin-styles.ts";

export function SignInForm({
  email,
  onEmail,
  onPassword,
  onSubmit,
  password,
  showPassword,
  togglePassword,
}: {
  email: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
  password: string;
  showPassword: boolean;
  togglePassword: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <label className={LABEL_CLASS} htmlFor="signin-email">
          {copy.signIn.emailLabel}
        </label>
        <input
          autoComplete="email"
          className={INPUT_CLASS}
          id="signin-email"
          onInput={(event) => {
            onEmail(event.currentTarget.value);
          }}
          placeholder={copy.signIn.emailPlaceholder}
          type="email"
          value={email}
        />
      </div>
      <div>
        <div className="mb-[6px] flex items-center justify-between gap-3">
          <label
            className="text-[12.5px] font-semibold [line-height:normal]"
            htmlFor="signin-password"
          >
            {copy.signIn.passwordLabel}
          </label>
          <a
            className="inline-flex min-h-[32px] items-center text-[12.5px] font-semibold text-foreground underline underline-offset-[3px]"
            href="/forgot-password"
          >
            {copy.signIn.forgotPassword}
          </a>
        </div>
        <PasswordField
          id="signin-password"
          onInput={onPassword}
          show={showPassword}
          toggle={togglePassword}
          value={password}
        />
      </div>
      <button className={`${BTN_PRIMARY} mt-1`} type="submit">
        {copy.signIn.signInSubmit}
      </button>
    </form>
  );
}
