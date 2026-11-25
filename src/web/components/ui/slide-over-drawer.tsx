import { Content, Description, Portal, Root, Title } from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

function isToastTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest("[data-sonner-toast]") !== null;
}

/**
 * Reusable right-hand slide-over drawer built on Radix Dialog primitives.
 * @param props Drawer visibility, accessible metadata, header/body/footer slots.
 * @param props.ariaLabel Optional accessible dialog label.
 * @param props.children Scrollable main drawer body content.
 * @param props.description Optional screen-reader description.
 * @param props.footer Optional static bottom footer bar.
 * @param props.header Sticky header content above the scroll region.
 * @param props.onOpenChange Invoked when open state changes via overlay or Escape.
 * @param props.open Whether the drawer is open.
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
  return (
    <Root modal={false} onOpenChange={onOpenChange} open={open}>
      <Portal>
        {open ? (
          <div
            aria-hidden="true"
            className="ov-overlay-in fixed inset-0 z-40 bg-foreground/25 backdrop-blur-xs"
            onClick={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
        <Content
          aria-label={ariaLabel}
          className="ov-drawer-in fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-border bg-card text-foreground shadow-lift outline-none"
          onInteractOutside={(event) => {
            if (isToastTarget(event.target)) {
              event.preventDefault();
            }
          }}
        >
          <Title className="sr-only">{title}</Title>
          {description === undefined ? null : (
            <Description className="sr-only">{description}</Description>
          )}
          <div className="shrink-0 border-b border-border px-5 py-3.5">{header}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-scroll-region>
            {children}
          </div>
          {footer === undefined ? null : (
            <div className="shrink-0 border-t border-border bg-card px-5 py-3.5">{footer}</div>
          )}
        </Content>
      </Portal>
    </Root>
  );
}
