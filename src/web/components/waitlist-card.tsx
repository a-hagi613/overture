import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BusyIndicator } from "./busy-indicator.tsx";
import {
  CARD_CLASS,
  CARD_DESCRIPTION,
  CARD_HEADING,
  LABEL_CLASS,
  SWITCH_CLASS,
} from "./signin-styles.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { Input } from "./ui/input.tsx";

type Phase = "form" | "done";

function errorMessageFor(status: number) {
  return status === 429 ? copy.waitlist.rateLimited : copy.waitlist.error;
}

/**
 * The public waitlist form shown on `/signup` while public sign-up is closed (WS-22).
 *
 * It is deliberately frictionless: no Turnstile and no CAPTCHA, just email and two optional fields. The hidden
 * `company_url` field is a honeypot that a person never sees and a bot autofills; the server answers it with the same
 * confirmation and writes nothing.
 * @returns The waitlist card, or the confirmation after a submission.
 */
export function WaitlistCard() {
  const [phase, setPhase] = useState<Phase>("form");
  const [email, setEmail] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (pending) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/waitlist", {
        body: JSON.stringify({
          company_url: companyUrl,
          email: email.trim(),
          targetLocation: targetLocation.trim(),
          targetRole: targetRole.trim(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        setError(errorMessageFor(response.status));
        setPending(false);

        return;
      }

      setEmail(email.trim());
      setPhase("done");
    } catch {
      setError(copy.waitlist.error);
    }

    setPending(false);
  };

  if (phase === "done") {
    return (
      <>
        <Card ariaLabelledBy="waitlist-heading" className={CARD_CLASS} variant="elevated">
          <div className="mb-5 flex flex-col gap-1.5">
            <h1 className={CARD_HEADING} id="waitlist-heading">
              {copy.waitlist.successTitle}
            </h1>
            <p className={CARD_DESCRIPTION}>{copy.waitlist.successBody(email)}</p>
          </div>
          <div className="rounded-lg bg-ok-soft px-4 py-4 text-sm leading-relaxed text-ok">
            <p className="font-medium">{copy.waitlist.successNote}</p>
          </div>
        </Card>
        <p className={SWITCH_CLASS}>
          {copy.waitlist.signInPrompt}{" "}
          <Link
            className="font-semibold text-foreground underline decoration-input underline-offset-4 transition hover:decoration-foreground"
            to="/signin"
          >
            {copy.waitlist.signInAction}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <Card ariaLabelledBy="waitlist-heading" className={CARD_CLASS} variant="elevated">
        <div className="mb-6 flex flex-col gap-1.5">
          <h1 className={CARD_HEADING} id="waitlist-heading">
            {copy.waitlist.titlePlain}{" "}
            <em className="italic text-signal">{copy.waitlist.titleItalic}</em>
          </h1>
          <p className={CARD_DESCRIPTION}>{copy.waitlist.description}</p>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <label className={LABEL_CLASS} htmlFor="waitlist-email">
              {copy.waitlist.emailLabel}
            </label>
            <Input
              autoComplete="email"
              id="waitlist-email"
              name="email"
              onInput={(event) => {
                setEmail(event.currentTarget.value);
              }}
              placeholder={copy.waitlist.emailPlaceholder}
              required
              type="email"
              value={email}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="waitlist-role">
              {copy.waitlist.roleLabel}{" "}
              <span className="ml-1 font-normal text-muted-foreground">
                {copy.waitlist.optional}
              </span>
            </label>
            <Input
              autoComplete="off"
              id="waitlist-role"
              name="target_role"
              onInput={(event) => {
                setTargetRole(event.currentTarget.value);
              }}
              placeholder={copy.waitlist.rolePlaceholder}
              value={targetRole}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="waitlist-location">
              {copy.waitlist.locationLabel}{" "}
              <span className="ml-1 font-normal text-muted-foreground">
                {copy.waitlist.optional}
              </span>
            </label>
            <Input
              autoComplete="off"
              id="waitlist-location"
              name="target_location"
              onInput={(event) => {
                setTargetLocation(event.currentTarget.value);
              }}
              placeholder={copy.waitlist.locationPlaceholder}
              value={targetLocation}
            />
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed bottom-0 left-0 h-px w-px overflow-hidden opacity-0"
          >
            <label htmlFor="waitlist-company-url">{copy.waitlist.honeypotLabel}</label>
            <input
              autoComplete="off"
              id="waitlist-company-url"
              name="company_url"
              onChange={(event) => {
                setCompanyUrl(event.currentTarget.value);
              }}
              tabIndex={-1}
              type="text"
              value={companyUrl}
            />
          </div>
          <Button
            ariaBusy={pending}
            className="mt-1 w-full"
            disabled={pending}
            size="default"
            submit
            variant="primary"
          >
            {pending ? <BusyIndicator /> : null}
            {copy.waitlist.submit}
          </Button>
          {error === null ? null : (
            <p className="text-center text-xs font-semibold text-need" role="alert">
              {error}
            </p>
          )}
        </form>
      </Card>
      <p className={SWITCH_CLASS}>
        {copy.waitlist.signInPrompt}{" "}
        <Link
          className="font-semibold text-foreground underline decoration-input underline-offset-4 transition hover:decoration-foreground"
          to="/signin"
        >
          {copy.waitlist.signInAction}
        </Link>
      </p>
    </>
  );
}
