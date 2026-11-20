import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import { turnstileActionHeader, turnstileTokenHeader } from "../../shared/turnstile.ts";
import { GoogleMark } from "./google-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { authClient } from "../lib/auth-client.ts";
import { useTurnstile } from "../lib/turnstile.ts";

type Mode = "sign-in" | "sign-up";

type SocialProvider = "google" | "linkedin";

const CALLBACK_URL = "/signin";

const meSchema = z.object({
  user: z.unknown().nullable(),
  turnstileSiteKey: z.string().optional(),
  socialProviders: z.array(z.enum(["google", "linkedin"])).default([]),
});

const callbackCopy = new Map<string, string>([
  ["email_not_verified", copy.signIn.emailNotVerified],
  ["forbidden", copy.signIn.refusedEmail],
  ["rate_limited", copy.signIn.rateLimited],
]);

const headlineByMode = {
  "sign-in": { title: copy.signIn.title, description: copy.signIn.description },
  "sign-up": { title: copy.signIn.signUpTitle, description: copy.signIn.signUpDescription },
};

function presentError(status: number, code: string | undefined) {
  if (status === 403) {
    return code === "captcha_failed" ? copy.signIn.captchaFailed : copy.signIn.refusedEmail;
  }

  if (status === 429) {
    return copy.signIn.rateLimited;
  }

  return copy.signIn.genericError;
}

export function SignInCard() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const siteKeyFromCallback = callbackCopy.get(search.get("error") ?? "");
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [socialProviders, setSocialProviders] = useState<SocialProvider[]>([]);
  const socialAction = mode === "sign-up" ? "signup" : "signin";

  const { containerRef: socialContainer, obtainToken: obtainSocialToken } = useTurnstile(
    socialProviders.length > 0 ? siteKey : null,
    socialAction,
  );

  const { containerRef: magicContainer, obtainToken: obtainMagicToken } = useTurnstile(
    siteKey,
    "magiclink",
  );

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/me");

      if (response.ok) {
        const parsed = meSchema.parse(await response.json());

        setSiteKey(parsed.turnstileSiteKey ?? null);
        setSocialProviders(parsed.socialProviders);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    if (sentTo !== null || siteKeyFromCallback !== undefined) {
      return;
    }

    const check = async () => {
      const { data } = await authClient.getSession();

      if (data !== null) {
        void navigate("/", { replace: true });
      }
    };

    void check();
  }, [navigate, sentTo, siteKeyFromCallback]);

  const confirmToken = async (obtainToken: () => Promise<string | null>) => {
    const token = await obtainToken();

    if (token === null) {
      setActionError(copy.signIn.captchaMissing);

      return null;
    }

    return token;
  };

  const onSocial = async (provider: SocialProvider) => {
    const token = await confirmToken(obtainSocialToken);

    if (token === null) {
      return;
    }

    const result = await authClient.signIn
      .social({
        provider,
        callbackURL: CALLBACK_URL,
        errorCallbackURL: CALLBACK_URL,
        fetchOptions: {
          headers: { [turnstileTokenHeader]: token, [turnstileActionHeader]: socialAction },
        },
      })
      .catch(() => null);

    if (result !== null && result.error !== null) {
      setActionError(presentError(result.error.status, result.error.code));
    }
  };

  const onMagic = async () => {
    const token = await confirmToken(obtainMagicToken);

    if (token === null) {
      return;
    }

    const result = await authClient.signIn
      .magicLink({
        email,
        callbackURL: CALLBACK_URL,
        fetchOptions: {
          headers: { [turnstileTokenHeader]: token, [turnstileActionHeader]: "magiclink" },
        },
      })
      .catch(() => null);

    if (result === null) {
      setActionError(copy.signIn.genericError);

      return;
    }

    if (result.error === null) {
      setSentTo(email);
      setActionError(null);

      return;
    }

    setActionError(presentError(result.error.status, result.error.code));
  };

  const isSent = sentTo !== null;

  const headline = isSent
    ? { title: copy.signIn.sentTitle, description: copy.signIn.sentDescription }
    : headlineByMode[mode];

  const presentedError = siteKeyFromCallback ?? actionError;

  return (
    <section
      aria-labelledby="signin-heading"
      className="relative rounded-xl border border-border bg-card px-5 pb-[22px] pt-6 shadow-lift min-[961px]:px-[30px] min-[961px]:pb-[26px] min-[961px]:pt-8"
    >
      <div className="mb-[22px] flex flex-col gap-1.5">
        <h1
          className="font-serif font-serif-tight text-[30px] leading-[1.05] min-[961px]:text-[34px]"
          id="signin-heading"
        >
          {headline.title}
        </h1>
        <p className="text-[13.5px] leading-normal text-muted-foreground">{headline.description}</p>
      </div>
      {isSent ? (
        <div className="flex flex-col gap-3.5">
          <div
            className="flex items-start gap-3 rounded-lg px-4 py-[15px] text-[13.5px] leading-normal text-ok"
            style={{ background: "var(--color-ok-soft)" }}
          >
            <NavGlyph name="mail" size={18} />
            <div>
              <p>
                <span className="font-semibold">{copy.signIn.sentHeading}</span>{" "}
                <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{sentTo}</span>
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">{copy.signIn.sentDetail}</p>
            </div>
          </div>
          <button
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[7px] border border-input bg-card px-[18px] text-[13.5px] font-semibold shadow-[0_1px_0_rgba(21,19,17,0.04)] [line-height:normal] max-[960px]:min-h-[46px] hover:bg-muted"
            onClick={() => {
              void onMagic();
            }}
            type="button"
          >
            {copy.signIn.resend}
          </button>
          <p className="text-center text-[13.5px] text-muted-foreground">
            {copy.signIn.resendHint}
          </p>
          <button
            className="inline-flex min-h-[42px] w-full items-center justify-center rounded-md bg-transparent px-[14px] text-[13.5px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              setSentTo(null);
              setActionError(null);
            }}
            type="button"
          >
            {copy.signIn.changeEmail}
          </button>
        </div>
      ) : (
        <div>
          {socialProviders.includes("google") ? (
            <button
              className="inline-flex min-h-[46px] w-full items-center justify-center gap-2.5 rounded-[7px] bg-foreground px-5 text-sm font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.08)] [line-height:normal] hover:bg-btn-hover"
              onClick={() => {
                void onSocial("google");
              }}
              type="button"
            >
              <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-white">
                <GoogleMark />
              </span>
              {copy.signIn.google}
            </button>
          ) : null}
          {socialProviders.includes("linkedin") ? (
            <button
              className="mt-2.5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[7px] border border-input bg-card px-[18px] text-[13.5px] font-semibold shadow-[0_1px_0_rgba(21,19,17,0.04)] [line-height:normal] max-[960px]:min-h-[46px] hover:bg-muted"
              onClick={() => {
                void onSocial("linkedin");
              }}
              type="button"
            >
              <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded border border-input bg-muted text-[11px] font-bold">
                {copy.signIn.linkedinBadge}
              </span>
              {copy.signIn.linkedin}
            </button>
          ) : null}
          {socialProviders.length === 0 ? null : (
            <div
              aria-hidden="true"
              className="my-[18px] flex items-center gap-3 text-xs text-muted-foreground leading-[18px]"
            >
              <hr className="flex-1 border-border" />
              <span>{copy.signIn.magicLegend}</span>
              <hr className="flex-1 border-border" />
            </div>
          )}
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onMagic();
            }}
          >
            <div>
              <label
                className="mb-[6px] block text-[12.5px] font-semibold [line-height:normal]"
                htmlFor="signin-email"
              >
                {copy.signIn.emailLabel}
              </label>
              <input
                autoComplete="email"
                className="h-[46px] w-full rounded-[7px] border border-input bg-card px-3.5 text-sm font-medium placeholder:text-muted-foreground"
                id="signin-email"
                onInput={(event) => {
                  setEmail(event.currentTarget.value);
                }}
                placeholder={copy.signIn.emailPlaceholder}
                type="email"
                value={email}
              />
            </div>
            <button
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[7px] border border-input bg-card px-[18px] text-[13.5px] font-semibold shadow-[0_1px_0_rgba(21,19,17,0.04)] [line-height:normal] max-[960px]:min-h-[46px] hover:bg-muted"
              type="submit"
            >
              {copy.signIn.magicSubmit}
            </button>
          </form>
          <p className="flex items-start gap-[9px] text-pretty text-[12.5px] leading-[1.52] text-muted-foreground">
            <span className="mt-0.5 flex-none">
              <NavGlyph name="lock" size={14} />
            </span>
            <span>
              <span className="font-semibold text-foreground">{copy.signIn.allowHeading}</span>{" "}
              {mode === "sign-up" ? copy.signIn.signUpNote : copy.signIn.allowNote}
            </span>
          </p>
          <p className="text-center text-[13px] text-muted-foreground">
            {mode === "sign-up" ? copy.signIn.switchBackPrompt : copy.signIn.switchPrompt}{" "}
            <button
              className="inline min-h-[44px] border-0 bg-transparent px-1 text-[13px] font-semibold text-foreground underline underline-offset-[3px]"
              onClick={() => {
                setMode(mode === "sign-up" ? "sign-in" : "sign-up");
                setActionError(null);
              }}
              type="button"
            >
              {mode === "sign-up" ? copy.signIn.switchToSignIn : copy.signIn.switchToSignUp}
            </button>
          </p>
        </div>
      )}
      <div data-turnstile="social" ref={socialContainer} />
      <div data-turnstile="magic" ref={magicContainer} />
      {presentedError === null ? null : (
        <p className="mt-2 text-[13px] font-semibold text-need" role="alert">
          {presentedError}
        </p>
      )}
    </section>
  );
}
