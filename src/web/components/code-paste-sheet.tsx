import { useRef, useState } from "react";
import { Link } from "react-router";

import type { CodeWait } from "../lib/code-wait-api.ts";

import { copy } from "../../shared/copy.ts";
import { clockText, remainingMs, useServerTime } from "../lib/code-wait-api.ts";
import { useModalSheet } from "../lib/use-modal-sheet.ts";
import { CodePasteHeader } from "./code-paste-header.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

export type CodePasteMode = "waiting" | "no_code" | "expired" | "accepted";

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

  useModalSheet(sheet, onClose, { focusSelector: "#code-paste-code" });

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
    <dialog
      aria-labelledby="code-paste-title"
      aria-modal="true"
      className="fixed inset-x-4 bottom-4 z-50 m-0 flex max-h-5/6 w-auto max-w-none flex-col overflow-y-auto rounded-2xl border border-border bg-card px-6 pb-6 pt-3 text-foreground shadow-lift md:inset-y-0 md:left-auto md:right-0 md:bottom-0 md:max-h-none md:w-full md:max-w-lg md:rounded-none md:border-y-0 md:border-l md:border-r-0 md:px-7 md:pt-5 xl:max-w-xl"
      data-scroll-region
      data-testid="code-paste-sheet"
      ref={sheet}
    >
      <button
        aria-label={copy.codePaste.grabHandle}
        className="flex h-11 w-full flex-none cursor-pointer items-center justify-center border-0 bg-transparent md:hidden"
        onClick={onClose}
        type="button"
      >
        <span className="h-1 w-11 rounded-full bg-input" />
      </button>

      <CodePasteHeader onClose={onClose} wait={wait} />

      {typing ? (
        <p className="mt-6 text-eyebrow font-semibold uppercase tracking-wider text-muted-foreground">
          {copy.codePaste.eyebrow}
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={closed ? "need" : "ok"}>
            {closed ? copy.codePaste.expired.pill : copy.codePaste.accepted.pill}
          </Badge>
          {closed ? null : <Badge variant="outline">{copy.codePaste.accepted.checking}</Badge>}
        </div>
      )}

      <h3
        className="mt-5 font-serif text-card-title leading-tight text-foreground"
        id="code-paste-title"
      >
        {`${entry.titlePlain} ${entry.titleItalic}`}
      </h3>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{entry.body}</p>

      {finished ? null : (
        <div className="mt-4">
          <label className="text-xs font-semibold text-foreground" htmlFor="code-paste-code">
            {copy.codePaste.label}
          </label>
          <Input
            ariaDescribedBy={invalid || shownError !== null ? "code-paste-error" : undefined}
            autoComplete="one-time-code"
            className={`mt-2 h-12 font-mono text-sm uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal ${
              closed ? "bg-muted text-muted-foreground" : "bg-card"
            }`}
            disabled={closed}
            id="code-paste-code"
            invalid={invalid || shownError !== null}
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
              <div className="mt-4 flex items-baseline justify-between gap-3">
                <span className="text-xs text-muted-foreground">{copy.codePaste.timeLeft}</span>
                <span className="font-mono text-xs tabular-nums text-foreground">
                  {clockText(remaining)}
                </span>
              </div>
              <div aria-hidden="true" className="mt-2 h-1 w-full rounded-full bg-muted">
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
        <p className="mt-2 text-xs leading-relaxed text-need" id="code-paste-error" role="alert">
          {invalid ? copy.codePaste.invalid : shownError}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        {typing ? (
          <>
            <Button disabled={pending} onClick={submit} size="default" variant="primary">
              {copy.codePaste.waiting.primary}
            </Button>
            {shown === "waiting" ? (
              <Button onClick={onNoCode} size="default" variant="secondary">
                {copy.codePaste.waiting.secondary}
              </Button>
            ) : (
              <Link
                className="inline-flex min-h-11 items-center text-sm font-semibold text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground md:min-h-10"
                to="/profile/account"
              >
                {copy.codePaste.noCode.secondary}
              </Link>
            )}
          </>
        ) : (
          <>
            <Button asChild size="default" variant="primary">
              <Link onClick={onClose} to="/home">
                {copy.codePaste.expired.primary}
              </Link>
            </Button>
            <Button asChild size="default" variant="secondary">
              <Link to="/tracker">{copy.codePaste.expired.secondary}</Link>
            </Button>
          </>
        )}
      </div>
    </dialog>
  );
}
