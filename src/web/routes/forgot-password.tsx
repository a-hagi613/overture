import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { turnstileActionHeader, turnstileTokenHeader } from "../../shared/turnstile.ts";
import { BusyIndicator } from "../components/busy-indicator.tsx";
import { NavGlyph } from "../components/nav-glyph.tsx";
import { SignInLayout } from "../components/signin-layout.tsx";
import {
  BTN_PRIMARY,
  CARD_CLASS,
  CARD_DESCRIPTION,
  CARD_HEADING,
  INPUT_CLASS,
  LABEL_CLASS,
  SWITCH_CLASS,
} from "../components/signin-styles.ts";
import { authClient } from "../lib/auth-client.ts";
import { useTurnstile, turnstileFailureMessage } from "../lib/turnstile.ts";
import { useTurnstileConfig } from "../lib/turnstile-config.ts";

export function ForgotPasswordPage() {
  const config = useTurnstileConfig();

  const { containerRef, obtainToken } = useTurnstile(
    config === undefined ? undefined : config.siteKey,
    "reset",
    config?.scriptUrl,
  );

  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const result = await obtainToken();

    if (result.token === null) {
      setError(turnstileFailureMessage(result.failure));

      return;
    }

    const authResult = await authClient
      .requestPasswordReset({
        email: email.trim(),
        redirectTo: `${globalThis.location.origin}/reset-password`,
        fetchOptions: {
          headers: { [turnstileTokenHeader]: result.token, [turnstileActionHeader]: "reset" },
        },
      })
      .catch(() => null);

    if (authResult === null) {
      setError(copy.signIn.genericError);

      return;
    }

    if (authResult.error !== null) {
      setError(
        authResult.error.status === 429 ? copy.signIn.rateLimited : copy.signIn.genericError,
      );

      return;
    }

    setError(null);
    setNotice(copy.signIn.forgotSent);
  };

  const onSubmit = async () => {
    if (pending) {
      return;
    }

    setPending(true);
    await submit();
    setPending(false);
  };

  return (
    <SignInLayout>
      <section aria-labelledby="forgot-heading" className={CARD_CLASS}>
        <div className="mb-[22px] flex flex-col gap-1.5">
          <h1 className={CARD_HEADING} id="forgot-heading">
            {copy.signIn.forgotTitle}
          </h1>
          <p className={CARD_DESCRIPTION}>{copy.signIn.forgotDescription}</p>
        </div>
        <div className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmit();
            }}
          >
            <div>
              <label className={LABEL_CLASS} htmlFor="forgot-email">
                {copy.signIn.emailLabel}
              </label>
              <input
                autoComplete="email"
                className={INPUT_CLASS}
                id="forgot-email"
                onInput={(event) => {
                  setEmail(event.currentTarget.value);
                }}
                placeholder={copy.signIn.emailPlaceholder}
                type="email"
                value={email}
              />
            </div>
            <button
              aria-busy={pending || undefined}
              className={BTN_PRIMARY}
              disabled={pending}
              type="submit"
            >
              {pending ? <BusyIndicator /> : null}
              {copy.signIn.forgotSubmit}
            </button>
          </form>
          <p className="text-center text-[13.5px] leading-normal text-muted-foreground">
            {copy.signIn.forgotNote}
          </p>
          <p className="text-center text-[13.5px] leading-normal text-muted-foreground">
            {copy.signIn.resendHint}
          </p>
          {notice === null ? null : (
            <output className="block text-center text-[13px] font-semibold text-ok">
              {notice}
            </output>
          )}
          {error === null ? null : (
            <p className="text-center text-[13px] font-semibold text-need" role="alert">
              {error}
            </p>
          )}
        </div>
        <div data-turnstile="reset" ref={containerRef} />
      </section>
      <p className={SWITCH_CLASS}>
        <Link
          className="inline-flex max-md:min-h-[44px] max-md:-my-[13px] items-center gap-2 px-1 font-semibold text-foreground underline underline-offset-[3px] hover:no-underline"
          to="/signin"
        >
          <NavGlyph name="back" size={15} />
          {copy.signIn.backToSignIn}
        </Link>
      </p>
    </SignInLayout>
  );
}
