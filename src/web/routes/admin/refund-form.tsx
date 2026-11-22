import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { postRefund } from "../../lib/admin-api.ts";
import type { BillingPeriod } from "../../lib/admin-api.ts";
import { REFUND_REASON_KEYS } from "./refund-reasons.ts";

type Notice = { kind: "done"; replayed: boolean } | { kind: "error"; message: string } | null;

function dollarsToCents(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

function newKey() {
  return crypto.randomUUID();
}

export function RefundForm({ userId, period }: { userId: string; period: BillingPeriod }) {
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const edited = () => {
    setIdempotencyKey(newKey());
  };

  const validate = () => {
    if (reason === "") {
      return copy.admin.billingRefundReasonMissing;
    }

    if (note.trim() === "") {
      return copy.admin.billingRefundNoteMissing;
    }

    return null;
  };

  const submit = async () => {
    const missing = validate();

    setProblem(missing);

    if (missing !== null) {
      return;
    }

    const amountCents = mode === "partial" ? dollarsToCents(amount) : null;

    if (mode === "partial" && amountCents === null) {
      setProblem(copy.admin.billingRefundAmountMissing);

      return;
    }

    setSubmitting(true);

    try {
      const result = await postRefund({
        amountCents,
        grantId: period.grantId,
        idempotencyKey,
        note: note.trim(),
        reason,
      });

      setNotice({ kind: "done", replayed: result.replayed });
    } catch {
      setNotice({ kind: "error", message: copy.admin.billingRefundFailed });
    }

    setSubmitting(false);
  };

  if (notice?.kind === "done") {
    return (
      <output className="mt-4 block rounded-md bg-ok-soft px-3 py-2.5 text-[13px] text-ok">
        {notice.replayed ? copy.admin.billingRefundReplayed : copy.admin.billingRefundDone}
      </output>
    );
  }

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-[12.5px] font-semibold">
          {copy.admin.billingRefundAmountLabel}
        </legend>
        <div className="flex min-h-11 items-start gap-3 rounded-md border border-input p-3 hover:bg-muted">
          <input
            id="refund-full"
            type="radio"
            name="refund-amount"
            className="mt-1"
            checked={mode === "full"}
            onChange={() => {
              setMode("full");
              edited();
            }}
          />
          <label htmlFor="refund-full" className="cursor-pointer">
            <span className="block text-[13px] font-semibold">{copy.admin.billingRefundFull}</span>
            <span className="block text-[12px] text-muted-foreground">
              {copy.admin.billingRefundFullHint}
            </span>
          </label>
        </div>
        <div className="flex min-h-11 items-start gap-3 rounded-md border border-input p-3 hover:bg-muted">
          <input
            id="refund-partial"
            type="radio"
            name="refund-amount"
            className="mt-1"
            checked={mode === "partial"}
            onChange={() => {
              setMode("partial");
              edited();
            }}
          />
          <div className="min-w-0 flex-1">
            <label htmlFor="refund-partial" className="cursor-pointer">
              <span className="block text-[13px] font-semibold">
                {copy.admin.billingRefundPartial}
              </span>
              <span className="block text-[12px] text-muted-foreground">
                {copy.admin.billingRefundPartialHint}
              </span>
            </label>
            {mode === "partial" ? (
              <input
                aria-label={copy.admin.billingRefundAmountInput}
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  edited();
                }}
                className="mt-2 h-11 w-full rounded-md border border-input bg-background px-2.5 text-[13px] md:h-9"
              />
            ) : null}
          </div>
        </div>
      </fieldset>

      <div>
        <label htmlFor="refund-reason" className="block text-[12.5px] font-semibold">
          {copy.admin.billingRefundReasonLabel}
        </label>
        <select
          id="refund-reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            edited();
          }}
          className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-2.5 text-[13px] md:h-9"
        >
          <option value="">{copy.admin.billingRefundReasonPlaceholder}</option>
          {REFUND_REASON_KEYS.map((key) => (
            <option key={key} value={key}>
              {copy.admin.billingRefundReasons[key]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="refund-note" className="block text-[12.5px] font-semibold">
          {copy.admin.billingRefundNoteLabel}
        </label>
        <textarea
          id="refund-note"
          rows={3}
          value={note}
          placeholder={copy.admin.billingRefundNotePlaceholder}
          onChange={(event) => {
            setNote(event.target.value);
            edited();
          }}
          className="mt-1.5 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[13px]"
        />
        <p className="mt-1 text-[12px] text-muted-foreground">{copy.admin.billingRefundNoteHint}</p>
      </div>

      <div className="rounded-md bg-muted px-4 py-3">
        <p className="text-[13px] font-semibold">{copy.admin.billingRefundWhatHappens}</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {copy.admin.billingRefundWhatHappensBody}
        </p>
      </div>

      {problem === null ? null : (
        <p role="alert" className="text-[13px] text-need">
          {problem}
        </p>
      )}
      {notice?.kind === "error" ? (
        <p role="alert" className="text-[13px] text-need">
          {notice.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-[13px] font-semibold text-card hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9"
        >
          {copy.admin.billingRefundSubmit}
        </button>
        <Link
          to={`/admin/billing/users/${encodeURIComponent(userId)}`}
          className="inline-flex min-h-11 items-center px-3 text-[13px] underline md:min-h-9"
        >
          {copy.admin.billingRefundCancel}
        </Link>
      </div>
    </form>
  );
}
