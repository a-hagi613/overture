import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import { turnstileActionHeader, turnstileTokenHeader } from "../../shared/turnstile.ts";
import { BusyIndicator } from "../components/busy-indicator.tsx";
import { NavGlyph } from "../components/nav-glyph.tsx";
import { PasswordField } from "../components/password-field.tsx";
import { SignInLayout } from "../components/signin-layout.tsx";
import {
  BTN_PRIMARY,
  CARD_CLASS,
  CARD_DESCRIPTION,
  CARD_HEADING,
  FIELD_HINT,
  LABEL_CLASS,
  SWITCH_CLASS,
} from "../components/signin-styles.ts";
import { authClient } from "../lib/auth-client.ts";
import { fetchOnboardingState } from "../lib/onboarding-api.ts";
import { useTurnstile, turnstileFailureMessage } from "../lib/turnstile.ts";
import { useTurnstileConfig } from "../lib/turnstile-config.ts";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";
  const config = useTurnstileConfig();

  const { containerRef: resetContainer, obtainToken: obtainResetToken } = useTurnstile(
    config === undefined ? undefined : config.siteKey,
    "reset",
    config?.scriptUrl,
  );

  const { containerRef: signInContainer, obtainToken: obtainSignInToken } = useTurnstile(
    config === undefined ? undefined : config.siteKey,
    "signin",
    config?.scriptUrl,
  );

  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(token === "" ? copy.signIn.resetInvalid : null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (token === "") {
      return;
    }

    const load = async () => {
      const response = await fetch(`/api/password-reset?token=${encodeURIComponent(token)}`);

      if (!response.ok) {
        setError(copy.signIn.resetInvalid);

        return;
      }

      const parsed = z.object({ email: z.email() }).safeParse(await response.json());

      if (parsed.success) {
        setEmail(parsed.data.email);
      } else {
        setError(copy.signIn.resetInvalid);
      }
    };

    void load();
  }, [token]);

  const onSubmit = async () => {
    if (password.length < 10) {
      setError(copy.signIn.passwordShort);

      return;
    }

    if (password !== confirm) {
      setError(copy.signIn.passwordMismatch);

      return;
    }

    setSaving(true);

    const resetToken = await obtainResetToken();

    if (resetToken.token === null) {
      setSaving(false);
      setError(turnstileFailureMessage(resetToken.failure));

      return;
    }

    const result = await authClient
      .resetPassword({
        newPassword: password,
        token,
        fetchOptions: {
          headers: { [turnstileTokenHeader]: resetToken.token, [turnstileActionHeader]: "reset" },
        },
      })
      .catch(() => null);

    setSaving(false);

    if (result === null) {
      setError(copy.signIn.resetInvalid);

      return;
    }

    if (result.error !== null) {
      setError(
        result.error.code === "PASSWORD_COMPROMISED"
          ? copy.signIn.passwordCompromised
          : copy.signIn.resetInvalid,
      );

      return;
    }

    if (email !== null) {
      const signInToken = await obtainSignInToken();

      if (signInToken.token !== null) {
        const signedIn = await authClient.signIn
          .email({
            email,
            password,
            fetchOptions: {
              headers: {
                [turnstileTokenHeader]: signInToken.token,
                [turnstileActionHeader]: "signin",
              },
            },
          })
          .catch(() => null);

        if (signedIn?.error === null) {
          const onboarding = await fetchOnboardingState().catch(() => null);

          void navigate(onboarding?.needsOnboarding === true ? "/onboarding" : "/", {
            replace: true,
          });

          return;
        }
      }
    }

    void navigate("/signin?reset=1", { replace: true });
  };

  return (
    <SignInLayout>
      <section aria-labelledby="reset-heading" className={CARD_CLASS}>
        <div className="mb-[22px] flex flex-col gap-1.5">
          <h1 className={CARD_HEADING} id="reset-heading">
            {copy.signIn.resetTitle}
          </h1>
          <p className={CARD_DESCRIPTION}>
            {copy.signIn.resetDescription(email ?? "your account")}
          </p>
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
              <div className="mb-[6px] flex items-center justify-between gap-3">
                <label
                  className="text-[12.5px] font-semibold [line-height:normal]"
                  htmlFor="reset-password"
                >
                  {copy.signIn.newPasswordLabel}
                </label>
              </div>
              <PasswordField
                autoComplete="new-password"
                id="reset-password"
                onInput={setPassword}
                show={showPassword}
                toggle={() => {
                  setShowPassword(!showPassword);
                }}
                value={password}
              />
              <p className={FIELD_HINT}>{copy.signIn.resetPasswordHint}</p>
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="reset-confirm">
                {copy.signIn.confirmPasswordLabel}
              </label>
              <PasswordField
                autoComplete="new-password"
                id="reset-confirm"
                onInput={setConfirm}
                show={showConfirm}
                toggle={() => {
                  setShowConfirm(!showConfirm);
                }}
                value={confirm}
              />
            </div>
            <button
              aria-busy={saving || undefined}
              className={`${BTN_PRIMARY} mt-1`}
              disabled={saving}
              type="submit"
            >
              {saving ? <BusyIndicator /> : null}
              {copy.signIn.resetSubmit}
            </button>
          </form>
          <p className="text-center text-[13.5px] leading-normal text-muted-foreground">
            {copy.signIn.resetSignOutNote}
          </p>
          {error === null ? null : (
            <p className="text-center text-[13px] font-semibold text-need" role="alert">
              {error}
            </p>
          )}
        </div>
        <div data-turnstile="reset" ref={resetContainer} />
        <div data-turnstile="signin" ref={signInContainer} />
      </section>
      <p className={SWITCH_CLASS}>
        <Link
          className="inline-flex min-h-[44px] items-center gap-2 px-1 font-semibold text-foreground underline underline-offset-[3px]"
          to="/signin"
        >
          <NavGlyph name="back" size={15} />
          {copy.signIn.backToSignIn}
        </Link>
      </p>
    </SignInLayout>
  );
}
