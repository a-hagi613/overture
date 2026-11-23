import { ArrowRight, CheckCircle2, FileText, Search } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

function renderPointIcon(index: number) {
  if (index === 0) {
    return <Search aria-hidden="true" size={18} />;
  }

  if (index === 1) {
    return <FileText aria-hidden="true" size={18} />;
  }

  return <CheckCircle2 aria-hidden="true" size={18} />;
}

export function OnboardingWelcomeCard({ onContinue }: { onContinue: () => Promise<void> }) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const continueOn = async () => {
    setFailed(false);
    setBusy(true);

    try {
      await onContinue();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-8" variant="elevated">
      <h2 className={dsCardTitle} id="ob-h">
        {`${copy.onboarding.welcomeTitlePlain} ${copy.onboarding.welcomeTitleItalic}`}
      </h2>
      <p className={`${dsBody} mt-2`}>{copy.onboarding.welcomeIntro}</p>

      <ul className="mt-6 flex flex-col gap-4">
        {copy.onboarding.welcomePoints.map((point, index) => (
          <li className="flex items-start gap-3.5" key={point.title}>
            <span
              aria-hidden="true"
              className={
                index === 2
                  ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ok/30 bg-ok-soft text-ok"
                  : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground"
              }
            >
              {renderPointIcon(index)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{point.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{point.body}</p>
            </div>
          </li>
        ))}
      </ul>

      {failed ? (
        <p className="mt-4 text-xs font-semibold text-need" role="alert">
          {copy.onboarding.saveFailed}
        </p>
      ) : null}

      <div className="mt-7 flex items-center justify-end border-t border-border pt-5">
        <Button
          disabled={busy}
          onClick={() => {
            void continueOn();
          }}
          size="lg"
          variant="primary"
        >
          <span>{copy.onboarding.continue}</span>
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </Card>
  );
}
