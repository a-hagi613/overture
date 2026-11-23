import { Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { Send, X } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

export type ReadyConfirmTarget =
  | { kind: "all"; count: number }
  | { kind: "single"; company: string; id: string; title: string };

function copyFor(target: ReadyConfirmTarget | null) {
  if (target === null) {
    return { body: "", confirm: "", title: "" };
  }

  if (target.kind === "all") {
    return {
      body: copy.ready.confirm.allBody,
      confirm: copy.ready.confirm.allAction(target.count),
      title: copy.ready.confirm.allTitle(target.count),
    };
  }

  return {
    body: copy.ready.confirm.singleBody,
    confirm: copy.ready.confirm.singleAction,
    title: copy.ready.confirm.singleTitle(target.company),
  };
}

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
  const open = target !== null;
  const text = copyFor(target);

  return (
    <Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={open}
    >
      <Portal>
        <Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]" />
        <Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-lift focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <Title className={dsCardTitle}>{text.title}</Title>
            <Button
              ariaLabel={copy.codePaste.close}
              className="h-8 w-8 shrink-0"
              onClick={onCancel}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden="true" size={16} />
            </Button>
          </div>
          {target !== null && target.kind === "single" ? (
            <p className="mt-1 text-sm font-medium text-signal-text">{target.title}</p>
          ) : null}
          <Description className={`${dsBody} mt-3`}>{text.body}</Description>
          <div className="mt-6 flex flex-wrap justify-end gap-2.5">
            <Button disabled={busy} onClick={onCancel} size="default" variant="outline">
              {copy.ready.cancel}
            </Button>
            <Button disabled={busy} onClick={onConfirm} size="default" variant="primary">
              <Send aria-hidden="true" size={15} />
              <span>{text.confirm}</span>
            </Button>
          </div>
        </Content>
      </Portal>
    </Root>
  );
}
