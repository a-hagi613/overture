import { useId, useRef } from "react";
import type { ReactNode } from "react";

import { useModalSheet } from "../../lib/use-modal-sheet.ts";

/**
 * Reusable right-hand slide-over drawer, rendered as a native modal `<dialog>`.
 *
 * `showModal()` puts the panel in the browser's top layer, so the rest of the page is inert,
 * Tab stays inside the sheet, Escape and a backdrop click close it, focus moves in on open and
 * returns to the opener on close, and the body does not scroll behind it. That is the same
 * contract as the Board sheet (DESIGN.md §8, "Sheet").
 *
 * @param props Drawer visibility, accessible metadata, header/body/footer slots.
 * @param props.ariaLabel Optional accessible dialog name that overrides the title.
 * @param props.children Scrollable main drawer body content.
 * @param props.description Optional screen-reader description.
 * @param props.footer Optional static bottom footer bar.
 * @param props.header Sticky header content above the scroll region.
 * @param props.onOpenChange Invoked when open state changes via overlay or Escape.
 * @param props.open Whether the drawer is open. A closed drawer renders nothing.
 * @param props.title Screen-reader dialog title.
 * @returns Slide-over dialog drawer.
 */
export function SlideOverDrawer({
  ariaLabel,
  children,
  description,
  footer,
  header,
  onOpenChange,
  open,
  title,
}: {
  ariaLabel?: string | undefined;
  children: ReactNode;
  description?: string | undefined;
  footer?: ReactNode | undefined;
  header: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  if (!open) {
    return null;
  }

  return (
    <DrawerPanel
      ariaLabel={ariaLabel}
      description={description}
      footer={footer}
      header={header}
      onClose={() => {
        onOpenChange(false);
      }}
      title={title}
    >
      {children}
    </DrawerPanel>
  );
}

function DrawerPanel({
  ariaLabel,
  children,
  description,
  footer,
  header,
  onClose,
  title,
}: {
  ariaLabel?: string | undefined;
  children: ReactNode;
  description?: string | undefined;
  footer?: ReactNode | undefined;
  header: ReactNode;
  onClose: () => void;
  title: string;
}) {
  const sheetRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalSheet(sheetRef, onClose, { focusSelector: "[data-drawer-heading]" });

  return (
    <dialog
      aria-describedby={description === undefined ? undefined : descriptionId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel === undefined ? titleId : undefined}
      aria-modal="true"
      className="ov-drawer-in fixed inset-y-0 right-0 left-auto z-40 m-0 flex h-full max-h-none w-full max-w-xl flex-col overflow-hidden rounded-none border-0 border-l border-border bg-card p-0 text-foreground shadow-lift outline-none"
      data-sheet-backdrop="lift"
      ref={sheetRef}
      tabIndex={-1}
    >
      <h2 className="sr-only" data-drawer-heading="" id={titleId} tabIndex={-1}>
        {title}
      </h2>
      {description === undefined ? null : (
        <p className="sr-only" id={descriptionId}>
          {description}
        </p>
      )}
      <div className="shrink-0 border-b border-border px-5 py-3.5">{header}</div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
        data-scroll-region
      >
        {children}
      </div>
      {footer === undefined ? null : (
        <div className="shrink-0 border-t border-border bg-card px-5 py-3.5">{footer}</div>
      )}
    </dialog>
  );
}
