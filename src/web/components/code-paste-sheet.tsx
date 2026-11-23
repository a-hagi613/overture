import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import type { CodeWait } from "../lib/code-wait-api.ts";

import { copy } from "../../shared/copy.ts";
import { clockText, remainingMs, useServerTime } from "../lib/code-wait-api.ts";
import { CodePasteHeader } from "./code-paste-header.tsx";

export type CodePasteMode = "waiting" | "no_code" | "expired" | "accepted";

const PRIMARY =
  "inline-flex min-h-10 max-[767px]:min-h-11 flex-none cursor-pointer items-center justify-center rounded-md border border-foreground bg-foreground px-[18px] text-[13px] font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover disabled:opacity-60";

const SECONDARY =
  "inline-flex min-h-10 max-[767px]:min-h-11 flex-none cursor-pointer items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13px] font-semibold hover:bg-muted";

const PILL =
  "inline-flex items-center rounded-full px-[11px] py-[3px] text-[11.5px] font-semibold leading-normal";

function stateCopy(mode: CodePasteMode, company: string) {
  switch (mode) {
    case "no_code": {
      return copy.codePaste.noCode;
    }

    case "expired": {
      return copy.codePaste.expired;
    }

    case "accepted": {
      return { ...copy.codePaste.accepted, body: copy.codePaste.accepted.body(company) };
    }

    default: {
      return copy.codePaste.waiting;
    }
  }
}

export function CodePasteSheet({
  error,
  mode,
  onClose,
  onNoCode,
  onSubmit,
  pending,
  serverNow,
  wait,
}: {
  error: string | null;
  mode: CodePasteMode;
  onClose: () => void;
  onNoCode: () => void;
  onSubmit: (code: string) => void;
  pending: boolean;
  serverNow: number | undefined;
  wait: CodeWait;
}) {
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = sheet.current;
    const opener = document.activeElement;

    const focusable = () =>
      [
        ...(node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((item) => item.offsetParent !== null);

    const codeInput = node?.querySelector<HTMLElement>("#code-paste-code:not([disabled])");

    (codeInput ?? focusable().at(0))?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") {
        return;
      }

      const items = focusable();
      const first = items.at(0);
      const last = items.at(-1);

      if (items.length === 0 || first === undefined || last === undefined) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    node?.addEventListener("keydown", onKeyDown);

    return () => {
      node?.removeEventListener("keydown", onKeyDown);

      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, []);
  const now = useServerTime(serverNow);
  const remaining = remainingMs(wait, now);
  const total = Math.max(1, wait.expiresAt - wait.startedAt);
  const closed = mode === "expired" || (mode !== "accepted" && remaining <= 0);
  const shown: CodePasteMode = closed ? "expired" : mode;
  const entry = stateCopy(shown, wait.company);
  const finished = shown === "accepted";
  const typing = shown === "waiting" || shown === "no_code";
  const shownError = finished ? null : error;

  function submit() {
    if (pending) {
      return;
    }

    if (/^[A-Za-z0-9]{8}$/u.test(code)) {
      setInvalid(false);
      onSubmit(code);
    } else {
      setInvalid(true);
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-60 bg-[var(--color-scrim)]"
        onClick={onClose}
      />
      <dialog
        aria-labelledby="code-paste-title"
        aria-modal="true"
        className="board m-0 fixed inset-x-4 bottom-4 z-70 flex max-h-[calc(100dvh-32px)] max-w-none flex-col overflow-y-auto rounded-[16px] border border-border bg-card px-[22px] pt-[13px] pb-6 text-foreground shadow-lift md:inset-x-auto md:inset-y-0 md:right-0 md:bottom-0 w-[520px] max-[1699px]:w-[468px] max-md:w-auto md:rounded-none md:border-y-0 md:border-r-0 md:px-[26px] md:pt-5"
        data-testid="code-paste-sheet"
        open
        ref={sheet}
      >
        <button
          aria-label={copy.codePaste.grabHandle}
          className="flex h-11 w-full flex-none cursor-pointer items-center justify-center border-0 bg-transparent md:hidden"
          onClick={onClose}
          type="button"
        >
          <span className="h-[4px] w-[42px] rounded-full bg-input" />
        </button>

        <CodePasteHeader onClose={onClose} wait={wait} />

        {typing ? (
          <p className="mt-[22px] text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            {copy.codePaste.eyebrow}
          </p>
        ) : (
          <p className="mt-[14px] flex flex-wrap gap-2">
            <span className={`${PILL} ${closed ? "bg-need-soft text-need" : "bg-ok-soft text-ok"}`}>
              {closed ? copy.codePaste.expired.pill : copy.codePaste.accepted.pill}
            </span>
            {closed ? null : (
              <span className={`${PILL} bg-muted text-foreground`}>
                {copy.codePaste.accepted.checking}
              </span>
            )}
          </p>
        )}

        <h3 className="serif mt-[22px] text-[26px] leading-[1.15]" id="code-paste-title">
          {entry.titlePlain} <span className="italic">{entry.titleItalic}</span>
        </h3>

        <p className="mt-[30px] text-[13.5px] leading-[1.55] text-muted-foreground">{entry.body}</p>

        {finished ? null : (
          <div className="mt-[18px]">
            <label className="text-[12.5px] font-semibold" htmlFor="code-paste-code">
              {copy.codePaste.label}
            </label>
            <input
              aria-describedby={invalid || shownError !== null ? "code-paste-error" : undefined}
              autoComplete="one-time-code"
              className={`mono mt-2 h-[50px] w-full rounded-md border border-input px-[13px] text-[15px] tracking-[0.3em] uppercase placeholder:normal-case placeholder:tracking-[0.28em] placeholder:text-muted-foreground focus:border-foreground ${
                closed ? "bg-muted text-muted-foreground" : "bg-card"
              }`}
              disabled={closed}
              id="code-paste-code"
              maxLength={8}
              onChange={(event) => {
                setCode(event.target.value);
                setInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submit();
                }
              }}
              placeholder={copy.codePaste.placeholder}
              value={closed ? "" : code}
            />
            {closed ? null : (
              <>
                <div className="mt-[17px] flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-muted-foreground">
                    {copy.codePaste.timeLeft}
                  </span>
                  <span className="mono text-[12.5px]">{clockText(remaining)}</span>
                </div>
                <div aria-hidden="true" className="mt-2 h-[3px] w-full rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-signal"
                    style={{ width: `${String(Math.min(100, (remaining / total) * 100))}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {invalid || shownError !== null ? (
          <p
            className="mt-2 text-[12.5px] leading-[1.5] text-need"
            id="code-paste-error"
            role="alert"
          >
            {invalid ? copy.codePaste.invalid : shownError}
          </p>
        ) : null}

        <div className="mt-[22px] flex flex-wrap items-center gap-2.5">
          {typing ? (
            <>
              <button className={PRIMARY} disabled={pending} onClick={submit} type="button">
                {copy.codePaste.waiting.primary}
              </button>
              {shown === "waiting" ? (
                <button className={SECONDARY} onClick={onNoCode} type="button">
                  {copy.codePaste.waiting.secondary}
                </button>
              ) : (
                <Link
                  className="inline-flex min-h-11 items-center text-[13px] font-semibold underline decoration-input underline-offset-4 hover:decoration-foreground md:min-h-10"
                  to="/profile/account"
                >
                  {copy.codePaste.noCode.secondary}
                </Link>
              )}
            </>
          ) : (
            <>
              <Link className={PRIMARY} onClick={onClose} to="/">
                {copy.codePaste.expired.primary}
              </Link>
              <Link className={SECONDARY} to="/board">
                {copy.codePaste.expired.secondary}
              </Link>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
