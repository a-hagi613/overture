import { copy } from "../../shared/copy.ts";

import { BusyIndicator } from "./busy-indicator.tsx";
import { LABEL_CLASS } from "./signin-styles.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

export function SignInForm({
  email,
  onEmail,
  onSubmit,
  pending,
  busy,
  primary = false,
  refused = false,
  submitLabel = copy.signIn.magicSubmit,
  verifying = false,
}: {
  email: string;
  onEmail: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  busy: boolean;
  primary?: boolean;
  refused?: boolean;
  submitLabel?: string;
  verifying?: boolean;
}) {
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <label className={LABEL_CLASS} htmlFor="signin-email">
          {copy.signIn.emailLabel}
        </label>
        <Input
          ariaDescribedBy={refused ? "signin-email-error" : undefined}
          autoComplete="email"
          id="signin-email"
          invalid={refused}
          onInput={(event) => {
            onEmail(event.currentTarget.value);
          }}
          placeholder={copy.signIn.emailPlaceholder}
          required
          type="email"
          value={email}
        />
      </div>
      {refused ? (
        <p
          className="text-left text-xs font-semibold leading-relaxed text-need"
          id="signin-email-error"
          role="alert"
        >
          {copy.signIn.refusedField}
        </p>
      ) : null}
      <Button
        ariaBusy={busy || verifying}
        className="w-full"
        disabled={pending}
        size="default"
        submit
        variant={refused || primary ? "primary" : "secondary"}
      >
        {busy ? <BusyIndicator /> : null}
        {verifying ? copy.signIn.verifying : submitLabel}
      </Button>
      <span aria-live="polite" className="sr-only">
        {verifying ? copy.signIn.verifying : ""}
      </span>
    </form>
  );
}
