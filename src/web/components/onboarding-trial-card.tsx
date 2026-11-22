import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";

const text = copy.onboarding.trial;

export type TrialCardState = "verify" | "declined" | "used";

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
  return (
    <section
      aria-labelledby="ob-h"
      className="obd rounded-lg border border-border bg-card shadow-sh"
    >
      <h2
        className="serif"
        id="ob-h"
        style={{ fontSize: "clamp(28px, 4vw, 36px)", lineHeight: 1.1 }}
      >
        {text.titlePlain} <span className="italic">{text.titleItalic}</span>
      </h2>
      <p className="mt-2.5 max-w-[52ch] text-[14.5px] text-muted-foreground">{text.intro}</p>
      <p className="hint mt-3">{text.kicker}</p>

      {state === "verify" ? (
        <div className="mt-6">
          <button
            className="btn"
            disabled={busy}
            onClick={onVerify}
            style={{ minHeight: 44 }}
            type="button"
          >
            {busy ? text.verifying : text.verifyButton}
          </button>
          {error ? (
            <p className="hint mt-4 text-[color:var(--need)]" role="alert">
              {text.loadFailed}
            </p>
          ) : null}
        </div>
      ) : null}

      {state === "declined" ? (
        <div className="mt-6" role="alert">
          <h3 className="serif" style={{ fontSize: 22 }}>
            {text.declinedTitle}
          </h3>
          <p className="mt-2 text-[14px] text-muted-foreground">{text.declinedBody}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn" onClick={onVerify} style={{ minHeight: 44 }} type="button">
              {text.tryAnother}
            </button>
            <Link className="btn2" style={{ minHeight: 44 }} to="/settings/billing">
              {text.choosePlan}
            </Link>
          </div>
        </div>
      ) : null}

      {state === "used" ? (
        <div className="mt-6" role="alert">
          <h3 className="serif" style={{ fontSize: 22 }}>
            {text.usedTitle}
          </h3>
          <p className="mt-2 text-[14px] text-muted-foreground">{text.usedBody}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="btn" style={{ minHeight: 44 }} to="/settings/billing">
              {text.choosePlan}
            </Link>
            <button className="btn2" onClick={onVerify} style={{ minHeight: 44 }} type="button">
              {text.anotherCard}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
