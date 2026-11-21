import { copy } from "../../shared/copy.ts";

import { BusyIndicator } from "./busy-indicator.tsx";
import { BTN_PRIMARY, INPUT_CLASS, INPUT_ERROR_CLASS, LABEL_CLASS } from "./signin-styles.ts";

export function SignInForm({
  email,
  onEmail,
  onSubmit,
  pending,
  busy,
  refused = false,
}: {
  email: string;
  onEmail: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  busy: boolean;
  refused?: boolean;
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
          aria-describedby={refused ? "signin-email-error" : undefined}
          aria-invalid={refused || undefined}
          autoComplete="email"
          className={refused ? INPUT_ERROR_CLASS : INPUT_CLASS}
          id="signin-email"
          onInput={(event) => {
            onEmail(event.currentTarget.value);
          }}
          placeholder={copy.signIn.emailPlaceholder}
          type="email"
          value={email}
        />
      </div>
      {refused ? (
        <p
          className="text-left text-[12.5px] font-semibold leading-[1.5] text-need"
          id="signin-email-error"
        >
          {copy.signIn.refusedField}
        </p>
      ) : null}
      <button
        aria-busy={busy || undefined}
        className={`${BTN_PRIMARY} mt-1`}
        disabled={pending}
        type="submit"
      >
        {busy ? <BusyIndicator /> : null}
        {copy.signIn.magicSubmit}
      </button>
    </form>
  );
}
