import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";

const text = copy.onboarding.trial;

export type TrialCardState = "verify" | "declined" | "used";

const pillStyle = {
  verify: { background: "var(--well)", color: "var(--ink)" },
  declined: { background: "var(--needbg)", color: "var(--need)" },
  used: { background: "var(--accbg)", color: "var(--acct)" },
} as const;

function stateHeading({
  headingRef,
  pill,
  state,
  title,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  pill: string;
  state: TrialCardState;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2
        className="serif"
        id="ob-h"
        ref={headingRef}
        style={{ fontSize: 28, lineHeight: 1.1 }}
        tabIndex={-1}
      >
        {title}
      </h2>
      <span className="pill" style={pillStyle[state]}>
        {pill}
      </span>
    </div>
  );
}

export function OnboardingTrialCard({
  busy,
  error,
  onVerify,
  state,
}: {
  busy: boolean;
  error: boolean;
  onVerify: () => void;
  state: TrialCardState;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  const errorLine = error ? (
    <p className="hint mt-4" role="alert" style={{ color: "var(--need)" }}>
      {text.loadFailed}
    </p>
  ) : null;

  useEffect(() => {
    if (state !== "verify") {
      headingRef.current?.focus();
    }
  }, [state]);

  if (state === "declined") {
    return (
      <section
        aria-labelledby="ob-h"
        className="obd rounded-lg border border-border bg-card p-5 shadow-sh"
      >
        {stateHeading({
          headingRef,
          pill: text.declinedTitle,
          state: "declined",
          title: text.declinedTitle,
        })}
        <p className="hint mt-3 max-w-[620px]" role="alert">
          {text.declinedBody}
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            className="btn"
            disabled={busy}
            onClick={onVerify}
            style={{ minHeight: 44 }}
            type="button"
          >
            {text.tryAnother}
          </button>
          <Link className="btn2" style={{ minHeight: 44 }} to="/settings/billing">
            {text.choosePlan}
          </Link>
        </div>
        {errorLine}
      </section>
    );
  }

  if (state === "used") {
    return (
      <section
        aria-labelledby="ob-h"
        className="obd rounded-lg border border-border bg-card p-5 shadow-sh"
      >
        {stateHeading({ headingRef, pill: text.usedTitle, state: "used", title: text.usedHeading })}
        <p className="hint mt-3 max-w-[620px]" role="alert">
          {text.usedBody}
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Link className="btn2" style={{ minHeight: 44 }} to="/settings/billing">
            {text.choosePlan}
          </Link>
          <button
            className="btn2"
            disabled={busy}
            onClick={onVerify}
            style={{ minHeight: 44 }}
            type="button"
          >
            {text.anotherCard}
          </button>
        </div>
        {errorLine}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="ob-h"
      className="obd rounded-lg border border-border bg-card p-5 shadow-sh"
    >
      {stateHeading({ headingRef, pill: text.stepPill, state: "verify", title: text.verifyTitle })}
      <p className="hint mt-3 max-w-[620px]">{text.intro}</p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <button
          className="btn"
          disabled={busy}
          onClick={onVerify}
          style={{ minHeight: 44 }}
          type="button"
        >
          {busy ? text.verifying : text.verifyButton}
        </button>
        <Link className="btng" style={{ minHeight: 44 }} to="/onboarding/forward">
          {text.backButton}
        </Link>
      </div>
      {errorLine}
    </section>
  );
}
