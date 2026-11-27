import type { ReactNode } from "react";

import { SlideOverDrawerPanel } from "./slide-over-drawer-panel.tsx";

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
    <SlideOverDrawerPanel
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
    </SlideOverDrawerPanel>
  );
}
