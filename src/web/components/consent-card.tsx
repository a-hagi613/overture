import { useState } from "react";
import { Link } from "react-router";

import type { ConsentState } from "../../shared/consent.ts";

import { copy } from "../../shared/copy.ts";
import { longDate } from "../lib/consent-format.ts";
import { useAcceptConsent } from "../lib/consent-api.ts";

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
    } catch {
      setChecked(false);
      setFailed(true);
    }
  };

  return (
    <section
      aria-labelledby="consent-title"
      className="rounded-lg border border-border bg-card px-[20px] py-[24px] shadow-sh md:px-[28px] md:py-[28px]"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {copy.consent.eyebrow}
        </p>
        <span className="rounded-full border border-border px-[13px] py-[3px] font-mono text-[10px] uppercase tracking-[0.12em]">
          {copy.consent.versionLabel(state.current.version)}
        </span>
      </div>
      <h1
        className="mt-[22px] font-serif text-[31px] leading-[1.06] tracking-tight md:mt-[14px] md:text-[36px]"
        id="consent-title"
      >
        {copy.consent.title}
      </h1>
      <p className="mt-[14px] text-[14px] leading-[1.6] md:text-[14.5px]">{state.current.text}</p>
      <p className="mt-[14px] text-[14px] leading-[1.6] md:text-[14.5px]">
        {copy.consent.readNoticeBefore}
        <Link className="underline decoration-input underline-offset-[3px]" to="/terms">
          {copy.legal.termsLink}
        </Link>
        {copy.consent.readNoticeBetween}
        <Link className="underline decoration-input underline-offset-[3px]" to="/privacy">
          {copy.legal.privacyLink}
        </Link>
        {copy.consent.readNoticeEnd}
      </p>
      <label
        className="mt-[22px] flex cursor-pointer md:mt-[18px] items-center gap-[14px] rounded-md border border-input px-[18px] py-[14px]"
        htmlFor="consent-agree"
      >
        <input
          checked={checked}
          className="size-[17px] flex-none rounded-sm accent-[var(--color-foreground)]"
          disabled={accept.isPending}
          id="consent-agree"
          onChange={() => {
            void toggle();
          }}
          type="checkbox"
        />
        <span className="text-[13px] font-semibold md:text-[13.5px]">{copy.consent.agree}</span>
      </label>
      <p className="mt-[20px] text-[12px] leading-[1.6] text-muted-foreground md:mt-[16px] md:text-[12.5px]">
        {copy.consent.footnote}
      </p>
      {state.accepted === null ? null : (
        <output className="mt-1 block text-[12px] leading-[1.6] text-muted-foreground md:text-[12.5px]">
          {copy.consent.accepted(state.accepted.version, longDate(state.accepted.at))}
        </output>
      )}
      {failed ? (
        <p className="mt-1 text-[12px] leading-[1.6] text-need md:text-[12.5px]" role="alert">
          {copy.consent.acceptFailed}
        </p>
      ) : null}
    </section>
  );
}
