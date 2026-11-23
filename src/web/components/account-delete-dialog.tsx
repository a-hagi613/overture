import { Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import { requestDeletion, sendReauthLink, useDeletionState } from "../lib/account-api.ts";
import { Button } from "./ui/button.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

const errorBodySchema = z.object({ message: z.string().optional() });

async function readError(response: Response) {
  const parsed = errorBodySchema.safeParse(await response.json().catch(() => null));

  return parsed.success ? (parsed.data.message ?? null) : null;
}

export function AccountDeleteDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const state = useDeletionState(open);

  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reauthenticated = state.data?.reauthenticated ?? false;

  const handleSendReauth = async () => {
    setBusy(true);
    setError(null);

    const response = await sendReauthLink().catch(() => null);

    setBusy(false);

    if (response === null || !response.ok) {
      setError(
        (response === null ? null : await readError(response)) ??
          copy.deleteAccount.errors.linkFailed,
      );

      return;
    }

    setLinkSent(true);
    toast.success(copy.deleteAccount.linkSent);
  };

  const handleDelete = async () => {
    if (!checked) {
      setError(copy.deleteAccount.errors.confirmRequired);

      return;
    }

    setBusy(true);
    setError(null);

    const response = await requestDeletion().catch(() => null);

    setBusy(false);

    if (response === null || !response.ok) {
      setError(
        (response === null ? null : await readError(response)) ??
          copy.deleteAccount.errors.deleteFailed,
      );

      return;
    }

    toast.success(copy.deleteAccount.erasingHeading);
    onOpenChange(false);
  };

  let statusContent = (
    <div className="rounded-lg border border-border bg-muted p-3.5 text-xs leading-relaxed text-muted-foreground">
      {linkSent ? copy.deleteAccount.linkSent : copy.deleteAccount.reauthBody}
    </div>
  );

  if (state.isPending) {
    statusContent = (
      <output
        aria-busy="true"
        className="block rounded-lg border border-border bg-muted p-3.5 text-xs text-muted-foreground"
      >
        {copy.onboarding.loading}
      </output>
    );
  } else if (state.isError) {
    statusContent = (
      <div
        className="rounded-lg border border-need/40 bg-need-soft p-3.5 text-xs text-need"
        role="alert"
      >
        <p className="font-semibold">{copy.deleteAccount.errors.unauthorised}</p>
        <Button
          className="mt-2.5"
          disabled={state.isFetching}
          onClick={() => {
            void state.refetch();
          }}
          size="sm"
          variant="outline"
        >
          {copy.calendar.retry}
        </Button>
      </div>
    );
  } else if (reauthenticated) {
    statusContent = (
      <label
        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted p-3.5 text-sm text-foreground"
        htmlFor="account-delete-confirm"
      >
        <input
          checked={checked}
          className="mt-0.5 size-4 shrink-0 accent-need"
          id="account-delete-confirm"
          onChange={(event) => {
            setChecked(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        <span>{copy.deleteAccount.confirmCheckbox}</span>
      </label>
    );
  }

  let primaryAction = null;

  if (!state.isPending && !state.isError) {
    primaryAction = reauthenticated ? (
      <Button
        disabled={busy || !checked}
        onClick={() => {
          void handleDelete();
        }}
        size="default"
        variant="destructive"
      >
        {busy
          ? copy.nav.profilePages.deleteDialogDeleting
          : copy.nav.profilePages.deleteDialogConfirm}
      </Button>
    ) : (
      <Button
        disabled={busy}
        onClick={() => {
          void handleSendReauth();
        }}
        size="default"
        variant="destructive"
      >
        {busy ? copy.nav.profilePages.deleteDialogSending : copy.deleteAccount.sendLink}
      </Button>
    );
  }

  return (
    <Root onOpenChange={onOpenChange} open={open}>
      <Portal>
        <Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-sh focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-need">
              <AlertTriangle aria-hidden="true" size={18} />
              <Title className={dsCardTitle}>{copy.deleteAccount.warningHeading}</Title>
            </div>
            <Button
              ariaLabel={copy.codePaste.close}
              className="h-11 w-11 shrink-0"
              onClick={() => {
                onOpenChange(false);
              }}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden="true" size={16} />
            </Button>
          </div>

          <Description className={`${dsBody} mt-2`}>{copy.deleteAccount.cannotUndo}</Description>

          <div className="mt-4 space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {copy.settings.deleteDetail}
            </p>

            {statusContent}

            {error === null ? null : (
              <p className="text-xs font-semibold text-need" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-2.5 border-t border-border pt-4">
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
              size="default"
              variant="outline"
            >
              {copy.nav.profilePages.deleteDialogCancel}
            </Button>
            {primaryAction}
          </div>
        </Content>
      </Portal>
    </Root>
  );
}
