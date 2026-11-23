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
}: {
  email: string;
  onEmail: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  busy: boolean;
  primary?: boolean;
  refused?: boolean;
  submitLabel?: string;
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
          type="email"
          value={email}
        />
      </div>
      {refused ? (
        <p
          className="text-left text-xs font-semibold leading-relaxed text-need"
          id="signin-email-error"
        >
          {copy.signIn.refusedField}
        </p>
      ) : null}
      <Button
        ariaBusy={busy}
        className="w-full"
        disabled={pending}
        size="default"
        submit
        variant={refused || primary ? "primary" : "secondary"}
      >
        {busy ? <BusyIndicator /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
