import { copy } from "../../shared/copy.ts";

import { BusyIndicator } from "./busy-indicator.tsx";
import { PasswordField } from "./password-field.tsx";
import { BTN_PRIMARY, FIELD_HINT, INPUT_CLASS, LABEL_CLASS } from "./signin-styles.ts";

export function SignUpForm({
  email,
  onEmail,
  onPassword,
  onSubmit,
  password,
  pending,
  busy,
  showPassword,
  togglePassword,
}: {
  email: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
  password: string;
  pending: boolean;
  busy: boolean;
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
        <p className={`${FIELD_HINT} mt-2`}>{copy.signIn.signUpEmailHint}</p>
      </div>
      <div>
        <label className={LABEL_CLASS} htmlFor="signin-password">
          {copy.signIn.createPasswordLabel}
        </label>
        <PasswordField
          autoComplete="new-password"
          id="signin-password"
          onInput={onPassword}
          show={showPassword}
          toggle={togglePassword}
          value={password}
        />
        <p className={FIELD_HINT}>{copy.signIn.passwordHint}</p>
      </div>
      <button
        aria-busy={busy || undefined}
        className={`${BTN_PRIMARY} mt-1`}
        disabled={pending}
        type="submit"
      >
        {busy ? <BusyIndicator /> : null}
        {copy.signIn.signUpSubmit}
      </button>
    </form>
  );
}
