import { ReadyConfirmDialogPanel } from "./ready-confirm-dialog-panel.tsx";
import type { ReadyConfirmTarget } from "./ready-confirm-dialog-panel.tsx";

export type { ReadyConfirmTarget } from "./ready-confirm-dialog-panel.tsx";

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

  return (
    <ReadyConfirmDialogPanel
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
      target={target}
    />
  );
}
