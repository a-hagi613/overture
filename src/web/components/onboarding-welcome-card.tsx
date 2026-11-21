import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";

const POINT_GLYPHS = ["search", "doc", "check"] as const;

export function OnboardingWelcomeCard({ onContinue }: { onContinue: () => Promise<void> }) {
  const [failed, setFailed] = useState(false);

  const continueOn = async () => {
    setFailed(false);

    try {
      await onContinue();
    } catch {
      setFailed(true);
    }
  };

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
        {copy.onboarding.welcomeTitlePlain}{" "}
        <span className="italic">{copy.onboarding.welcomeTitleItalic}</span>
      </h2>
      <p className="mt-2.5 text-[14.5px] text-muted-foreground">{copy.onboarding.welcomeIntro}</p>
      <ul className="m-0 mt-[22px] flex list-none flex-col gap-[18px] p-0">
        {copy.onboarding.welcomePoints.map((point, index) => (
          <li className="flex items-start gap-3.5" key={point.title}>
            <span
              aria-hidden="true"
              className={
                index === 2
                  ? "flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border border-border bg-ok-soft text-ok"
                  : "flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border border-border bg-muted text-foreground"
              }
            >
              <NavGlyph name={POINT_GLYPHS[index] ?? "check"} size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{point.title}</p>
              <p className="mt-0.5 text-[14px] text-muted-foreground">{point.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {failed ? (
        <p className="hint mt-4 text-[color:var(--need)]" role="alert">
          {copy.onboarding.saveFailed}
        </p>
      ) : null}
      <div className="ftr mt-7 flex items-center justify-end gap-3 border-t border-border pt-5">
        <button
          className="btn"
          onClick={() => {
            void continueOn();
          }}
          style={{ minHeight: 48, padding: "0 26px" }}
          type="button"
        >
          {copy.onboarding.continue} <NavGlyph name="forward" size={16} />
        </button>
      </div>
    </section>
  );
}
