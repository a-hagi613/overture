import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import { GoogleMark } from "./google-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { authClient } from "../lib/auth-client.ts";
import { useTurnstile } from "../lib/turnstile.ts";

type Mode = "sign-in" | "sign-up";

const CALLBACK_URL = "/signin";

const meSchema = z.object({
  user: z.unknown().nullable(),
  turnstileSiteKey: z.string().optional(),
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

function presentError(status: number) {
  if (status === 403) {
    return copy.signIn.refusedEmail;
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
  const { containerRef, consume: consumeTurnstile, hasToken } = useTurnstile(siteKey);

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/me");

      if (response.ok) {
        const parsed = meSchema.parse(await response.json());

        setSiteKey(parsed.turnstileSiteKey ?? null);
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

  const consumedToken = () => consumeTurnstile() ?? "";

  const onSocial = async (provider: "google" | "linkedin") => {
    const result = await authClient.signIn
      .social({
        provider,
        callbackURL: CALLBACK_URL,
        errorCallbackURL: CALLBACK_URL,
        fetchOptions: { headers: { "x-captcha-response": consumedToken() } },
      })
      .catch(() => null);

    if (result !== null && result.error !== null) {
      setActionError(presentError(result.error.status));
    }
  };

  const onMagic = async () => {
    const result = await authClient.signIn
      .magicLink({
        email,
        callbackURL: CALLBACK_URL,
        fetchOptions: { headers: { "x-captcha-response": consumedToken() } },
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

    setActionError(presentError(result.error.status));
  };

  const isSent = sentTo !== null;

  const headline = isSent
    ? { title: copy.signIn.sentTitle, description: copy.signIn.sentDescription }
    : headlineByMode[mode];

  const presentedError = siteKeyFromCallback ?? actionError;

  return (
    <section
      aria-labelledby="signin-heading"
      className="relative rounded-xl border border-border bg-card px-[30px] pb-[26px] pt-8 shadow-lift"
    >
      <div className="mb-[22px] flex flex-col gap-1.5">
        <h1
          className="font-serif text-[30px] leading-[1.05] tracking-[-0.012em] min-[961px]:text-[34px]"
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
            className="inline-flex min-h-[46px] w-full items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            disabled={siteKey !== null && !hasToken}
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
          <button
            className="inline-flex min-h-[46px] w-full items-center justify-center gap-2.5 rounded-md bg-foreground px-5 text-sm font-semibold text-card shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover disabled:cursor-not-allowed disabled:opacity-60"
            disabled={siteKey !== null && !hasToken}
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
          <button
            className="mt-2.5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            disabled={siteKey !== null && !hasToken}
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
          <div
            aria-hidden="true"
            className="my-[18px] flex items-center gap-3 text-xs text-muted-foreground"
          >
            <hr className="flex-1 border-border" />
            <span>{copy.signIn.magicLegend}</span>
            <hr className="flex-1 border-border" />
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onMagic();
            }}
          >
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold" htmlFor="signin-email">
                {copy.signIn.emailLabel}
              </label>
              <input
                autoComplete="email"
                className="h-[46px] w-full rounded-md border border-input bg-card px-3.5 text-sm font-medium placeholder:text-muted-foreground"
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
              className="inline-flex min-h-[46px] w-full items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              disabled={siteKey !== null && !hasToken}
              type="submit"
            >
              {copy.signIn.magicSubmit}
            </button>
          </form>
          <div ref={containerRef} />
          <p className="mt-3.5 flex items-start gap-2 text-[12.5px] leading-[1.52] text-muted-foreground">
            <span className="mt-0.5 flex-none">
              <NavGlyph name="lock" size={14} />
            </span>
            <span>
              <span className="font-semibold text-foreground">{copy.signIn.allowHeading}</span>{" "}
              {mode === "sign-up" ? copy.signIn.signUpNote : copy.signIn.allowNote}
            </span>
          </p>
          <p className="mt-[18px] text-center text-[13px] text-muted-foreground">
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
      {presentedError === null ? null : (
        <p className="mt-2 text-[13px] font-semibold text-need" role="alert">
          {presentedError}
        </p>
      )}
    </section>
  );
}
