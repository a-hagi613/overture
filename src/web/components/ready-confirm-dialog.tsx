import { Check, X } from "lucide-react";
import { useId, useRef } from "react";

import { copy } from "../../shared/copy.ts";
import { useModalSheet } from "../lib/use-modal-sheet.ts";
import { Button } from "./ui/button.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

export interface ReadyConfirmTarget {
  kind: "single";
  company: string;
  id: string;
  title: string;
}

function copyFor(target: ReadyConfirmTarget | null) {
  if (target === null) {
    return { body: "", confirm: "", title: "" };
  }

  return {
    body: copy.ready.confirm.singleBody,
    confirm: copy.ready.confirm.singleAction,
    title: copy.ready.confirm.singleTitle(target.company),
  };
}

/**
 * Confirmation dialog for sending one prepared application.
 *
 * It is a native modal `<dialog>` opened with `showModal()`, so it stacks above the Ready
 * inspection sheet, keeps focus inside itself, closes on Escape and a backdrop click, and
 * returns focus to the control that opened it.
 *
 * @param props The target application, whether a send is in flight, and the cancel/confirm callbacks.
 * @param props.busy Whether the approval request is in flight.
 * @param props.onCancel Closes the dialog without sending.
 * @param props.onConfirm Sends the application.
 * @param props.target The application waiting for confirmation, or null when closed.
 * @returns The confirmation dialog, or nothing while it is closed.
 */
export function ReadyConfirmDialog({
  busy,
  onCancel,
  onConfirm,
  target,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  target: ReadyConfirmTarget | null;
}) {
  if (target === null) {
    return null;
  }

  return <ConfirmPanel busy={busy} onCancel={onCancel} onConfirm={onConfirm} target={target} />;
}

function ConfirmPanel({
  busy,
  onCancel,
  onConfirm,
  target,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  target: ReadyConfirmTarget;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const text = copyFor(target);

  useModalSheet(dialogRef, onCancel, { focusSelector: "[data-confirm-title]" });

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed left-1/2 top-1/2 z-50 m-0 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-foreground shadow-lift outline-none"
      ref={dialogRef}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className={dsCardTitle} data-confirm-title="" id={titleId} tabIndex={-1}>
          {text.title}
        </h2>
        <Button
          ariaLabel={copy.codePaste.close}
          className="h-11 w-11 shrink-0"
          onClick={onCancel}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" size={16} />
        </Button>
      </div>
      <p className="mt-1 text-sm font-medium text-muted-foreground">{target.title}</p>
      <p className={`${dsBody} mt-2.5`} id={descriptionId}>
        {text.body}
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2.5">
        <Button disabled={busy} onClick={onCancel} size="default" variant="outline">
          {copy.ready.cancel}
        </Button>
        <Button disabled={busy} onClick={onConfirm} size="default" variant="primary">
          <Check aria-hidden="true" size={15} />
          <span>{text.confirm}</span>
        </Button>
      </div>
    </dialog>
  );
}
