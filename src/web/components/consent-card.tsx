import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import type { ConsentState } from "../../shared/consent.ts";

import { copy } from "../../shared/copy.ts";
import { useAcceptConsent } from "../lib/consent-api.ts";
import { longDate } from "../lib/consent-format.ts";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow, dsPageTitle } from "./ui/ds.ts";

export function ConsentCard({ state }: { state: ConsentState }) {
  const accept = useAcceptConsent();
  const agreed = state.accepted?.version === state.current.version;
  const [checked, setChecked] = useState(agreed);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    if (checked || accept.isPending) {
      return;
    }

    setFailed(false);

    try {
      await accept.mutateAsync(state.current.version);
      setChecked(true);
      toast.success(copy.consent.agree);
    } catch {
      setChecked(false);
      setFailed(true);
    }
  };

  return (
    <Card ariaLabelledBy="consent-title" className="p-6 md:p-8" variant="elevated">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={dsEyebrow}>{copy.consent.eyebrow}</p>
        <Badge variant="outline">{copy.consent.versionLabel(state.current.version)}</Badge>
      </div>
      <h1 className={`${dsPageTitle} mt-3`} id="consent-title">
        {copy.consent.title}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-foreground">{state.current.text}</p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {copy.consent.readNoticeBefore}
        <Link
          className="font-medium text-signal-text underline underline-offset-4 hover:opacity-80"
          to="/terms"
        >
          {copy.legal.termsLink}
        </Link>
        {copy.consent.readNoticeBetween}
        <Link
          className="font-medium text-signal-text underline underline-offset-4 hover:opacity-80"
          to="/privacy"
        >
          {copy.legal.privacyLink}
        </Link>
        {copy.consent.readNoticeEnd}
      </p>
      <label
        className="mt-5 flex cursor-pointer items-center gap-3.5 rounded-lg border border-input bg-background px-4 py-3.5 transition hover:border-foreground/40"
        htmlFor="consent-agree"
      >
        <input
          checked={checked}
          className="size-4 shrink-0 accent-signal"
          disabled={accept.isPending}
          id="consent-agree"
          onChange={() => {
            void toggle();
          }}
          type="checkbox"
        />
        <span className="text-sm font-semibold text-foreground">{copy.consent.agree}</span>
      </label>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{copy.consent.footnote}</p>
      {state.accepted === null ? null : (
        <output className="mt-1.5 block text-xs font-medium text-ok">
          {copy.consent.accepted(state.accepted.version, longDate(state.accepted.at))}
        </output>
      )}
      {failed ? (
        <p className="mt-1.5 text-xs font-semibold text-need" role="alert">
          {copy.consent.acceptFailed}
        </p>
      ) : null}
    </Card>
  );
}
